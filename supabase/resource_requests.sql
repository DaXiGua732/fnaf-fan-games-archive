-- ============================================================================
-- 催资源 / Resource Requests —— Supabase 初始化脚本
-- ============================================================================
-- 在哪运行：Supabase Dashboard → SQL Editor → 新建查询 → 粘贴整个文件 → Run。
-- 可以重复运行（幂等）：表 / 索引用 IF NOT EXISTS，函数与视图用 CREATE OR REPLACE，
-- 策略先 DROP 再 CREATE。
--
-- 安全边界：
--   * 前端只使用 anon public key。它本来就是公开的，权限由本文件的 GRANT / RLS 决定。
--   * **绝对不要**在前端、仓库或本文档里出现 service_role key。
--   * anon / authenticated 不能直接写表；提交与投票只能走 security definer 函数。
--   * resource_requests 的 created_by_client 不授予 SELECT，客户端读不到原始身份。
--
-- 管理 / 审核：
--   * 本项目没有后台审核页。资源实际上线后，前台会按「标题精确相同」自动显示为已收录；
--     这不需要改数据库。
--   * 如果确实要人工下架一条请求，在 SQL Editor 里把 status 改成 'hidden'；
--     若要手工标记为完成，改成 'done'。两种状态都不会再出现在公开视图里。
--   * status = 'open' 才会出现在榜单上；normalized 相同的 open 请求只允许一条。
--
-- 去重说明：
--   client_id 是浏览器生成的随机身份，不是安全凭据；懂技术的人可以清空本地存储后
--   重新投票。这里的目标是让正常访客「同一浏览器只计一次」，不是抵御恶意刷票。
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 标题归一化：与前端 utils/requestMatch.ts 对齐
--   NFKC → 小写 → 去掉空白、标点与符号
-- 示例：'  Jolly  4!! ' / 'JOLLY-4' / 'Jolly+4' / 'ＪＯＬＬＹ－４' → 'jolly4'
-- ---------------------------------------------------------------------------
create or replace function public.normalize_resource_request_title(p_title text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(
    regexp_replace(
      normalize(coalesce(p_title, ''), NFKC),
      '[[:space:][:punct:]]+',
      '',
      'g'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 表
-- ---------------------------------------------------------------------------
create table if not exists public.resource_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 80),
  normalized text not null,
  votes integer not null default 0 check (votes >= 0),
  status text not null default 'open' check (status in ('open', 'done', 'hidden')),
  created_by_client text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同名 open 请求只能有一条。status 改成 done / hidden 后不再占用唯一位。
create unique index if not exists resource_requests_open_normalized_key
  on public.resource_requests (normalized)
  where status = 'open';

-- 「同一 client 24 小时内最多新建 5 条」的计数会扫这一列
create index if not exists resource_requests_client_created_idx
  on public.resource_requests (created_by_client, created_at desc);

create table if not exists public.resource_request_votes (
  request_id uuid not null references public.resource_requests(id) on delete cascade,
  client_id text not null check (char_length(client_id) between 8 and 64),
  created_at timestamptz not null default now(),
  primary key (request_id, client_id)
);

create index if not exists resource_request_votes_client_idx
  on public.resource_request_votes (client_id);

comment on table public.resource_requests is
  '公开催资源请求。写入只允许通过 submit_resource_request / vote_resource_request。';
comment on column public.resource_requests.created_by_client is
  '生成请求的匿名浏览器 ID；不通过公开视图暴露，只用于每日限额。';
comment on column public.resource_requests.normalized is
  '标题归一化值；用于去重与并发唯一约束，不通过公开视图暴露。';

-- ---------------------------------------------------------------------------
-- RLS / 权限
--   * requests：匿名只能 SELECT open 行，且只能读安全列（不含 created_by_client）
--   * votes：匿名没有任何直接权限
--   * 函数：security definer，只授予 EXECUTE
-- ---------------------------------------------------------------------------
alter table public.resource_requests enable row level security;
alter table public.resource_request_votes enable row level security;

revoke all on table public.resource_requests from anon, authenticated;
revoke all on table public.resource_request_votes from anon, authenticated;

-- 只授予安全列。security_invoker 视图需要 underlying 列的 SELECT 权限，
-- 所以 status 也在这里；created_by_client / normalized 不在授权列表中。
grant select (id, title, votes, status, created_at, updated_at)
  on public.resource_requests to anon, authenticated;

drop policy if exists resource_requests_select_open on public.resource_requests;
create policy resource_requests_select_open
  on public.resource_requests
  for select
  to anon, authenticated
  using (status = 'open');

-- ---------------------------------------------------------------------------
-- 公开视图：只暴露展示需要的列，隐藏 created_by_client / normalized / status
-- ---------------------------------------------------------------------------
create or replace view public.resource_request_board
with (security_invoker = true)
as
select id, title, votes, created_at, updated_at
from public.resource_requests
where status = 'open';

revoke all on table public.resource_request_board from anon, authenticated;
grant select on public.resource_request_board to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 提交请求
--
-- 行为：
--   1. 校验标题 2..80、client_id 8..64，归一化标题；
--   2. 同一 client 的调用先拿事务级 advisory lock —— 并发提交时
--      「每日 5 条」不会被同时穿透；
--   3. 已有同 normalized 的 open 请求 → 不再建新条目，只补一票；
--   4. 没有 → 检查该 client 最近 24h 新建数（上限 5）后插入；
--      INSERT 撞唯一索引时（另一个 client 同时提交了同名请求），
--      重新选中那条 open 行并投票 —— 不把并发错误抛给访客；
--   5. 投票明细 ON CONFLICT DO NOTHING，只有真正插入时才 +1。
-- ---------------------------------------------------------------------------
create or replace function public.submit_resource_request(
  p_title text,
  p_client_id text
)
returns table (
  id uuid,
  title text,
  votes integer,
  created_at timestamptz,
  created boolean,
  voted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_client_id text;
  v_normalized text;
  v_request public.resource_requests%rowtype;
  v_created boolean := false;
  v_added_vote integer := 0;
  v_recent_count integer;
begin
  v_title := btrim(coalesce(p_title, ''));
  v_client_id := btrim(coalesce(p_client_id, ''));

  if char_length(v_title) < 2 or char_length(v_title) > 80 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  if char_length(v_client_id) < 8 or char_length(v_client_id) > 64 then
    raise exception 'invalid client id' using errcode = '22023';
  end if;

  v_normalized := public.normalize_resource_request_title(v_title);
  if v_normalized = '' then
    raise exception 'invalid title' using errcode = '22023';
  end if;

  -- 同一浏览器身份串行化：每日限额在并发下仍然成立
  perform pg_advisory_xact_lock(
    hashtextextended('fnaf-resource-request-client:' || v_client_id, 0)
  );

  select r.*
    into v_request
  from public.resource_requests as r
  where r.normalized = v_normalized
    and r.status = 'open'
  for update;

  if not found then
    select count(*)
      into v_recent_count
    from public.resource_requests as r
    where r.created_by_client = v_client_id
      and r.created_at > now() - interval '24 hours';

    if v_recent_count >= 5 then
      raise exception 'DAILY_LIMIT' using errcode = 'P0001';
    end if;

    begin
      insert into public.resource_requests (title, normalized, votes, status, created_by_client)
      values (v_title, v_normalized, 0, 'open', v_client_id)
      returning * into v_request;

      v_created := true;
    exception
      when unique_violation then
        -- 另一个 client 在同一瞬间创建了同名请求。选中它并继续投票。
        select r.*
          into v_request
        from public.resource_requests as r
        where r.normalized = v_normalized
          and r.status = 'open'
        for update;

        if not found then
          -- 极小概率：并发创建者随后立刻被隐藏了。让访客刷新后重试。
          raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
        end if;

        v_created := false;
    end;
  end if;

  insert into public.resource_request_votes (request_id, client_id)
  values (v_request.id, v_client_id)
  on conflict (request_id, client_id) do nothing;

  get diagnostics v_added_vote = row_count;

  if v_added_vote > 0 then
    update public.resource_requests as r
       set votes = r.votes + 1,
           updated_at = now()
     where r.id = v_request.id
    returning r.* into v_request;
  end if;

  return query
  select r.id,
         r.title,
         r.votes,
         r.created_at,
         v_created,
         v_added_vote > 0
  from public.resource_requests as r
  where r.id = v_request.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 给已有请求 +1
-- ---------------------------------------------------------------------------
create or replace function public.vote_resource_request(
  p_request_id uuid,
  p_client_id text
)
returns table (
  id uuid,
  title text,
  votes integer,
  created_at timestamptz,
  added boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id text;
  v_request public.resource_requests%rowtype;
  v_added_vote integer := 0;
begin
  v_client_id := btrim(coalesce(p_client_id, ''));

  if p_request_id is null then
    raise exception 'invalid request id' using errcode = '22023';
  end if;
  if char_length(v_client_id) < 8 or char_length(v_client_id) > 64 then
    raise exception 'invalid client id' using errcode = '22023';
  end if;

  select r.*
    into v_request
  from public.resource_requests as r
  where r.id = p_request_id
    and r.status = 'open'
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.resource_request_votes (request_id, client_id)
  values (v_request.id, v_client_id)
  on conflict (request_id, client_id) do nothing;

  get diagnostics v_added_vote = row_count;

  if v_added_vote > 0 then
    update public.resource_requests as r
       set votes = r.votes + 1,
           updated_at = now()
     where r.id = v_request.id
    returning r.* into v_request;
  end if;

  return query
  select r.id,
         r.title,
         r.votes,
         r.created_at,
         v_added_vote > 0
  from public.resource_requests as r
  where r.id = v_request.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 函数执行权：先收回默认的 PUBLIC，再只给匿名 / 登录角色
-- ---------------------------------------------------------------------------
revoke all on function public.submit_resource_request(text, text) from public;
revoke all on function public.submit_resource_request(text, text) from anon, authenticated;
revoke all on function public.vote_resource_request(uuid, text) from public;
revoke all on function public.vote_resource_request(uuid, text) from anon, authenticated;

grant execute on function public.submit_resource_request(text, text) to anon, authenticated;
grant execute on function public.vote_resource_request(uuid, text) to anon, authenticated;

commit;
