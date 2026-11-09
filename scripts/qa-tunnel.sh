#!/usr/bin/env bash
# A temporary https link to the producer, for testing it with another person (the microphone and screen capture
# need https). It runs the Worker on this computer, in wrangler's local mode, and puts a Cloudflare QUICK tunnel in
# front of it: no Cloudflare account, no login, no deploy, nothing uploaded. See README.md, "A temporary link for
# testing". Usage: scripts/qa-tunnel.sh --help
set -uo pipefail
# Each program below runs in its own session (setsid, where it exists), so stopping it also stops what it started
# (npx, workerd), and a Ctrl+C at the terminal reaches only this script, which then stops them itself. Without setsid
# only the program itself is stopped, and npx has to pass the stop on.
own=(); command -v setsid >/dev/null && own=(setsid)

here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
self=scripts/qa-tunnel.sh

usage() {
  cat <<EOF
Usage: $self [REF] [--here] [--hours N] [--port N]

Starts a temporary https link to the producer and keeps it up until Ctrl+C or the time limit.

  (no REF)    the latest origin/dev, in a temporary copy that is removed at the end
  REF         any other branch, tag or commit, the same way (for example: $self build/some-branch); a branch name
              serves its copy on GitHub when there is one, so commits not pushed yet are not in it
  --here      this checkout as it is now, with changes not yet committed (refused if it holds a secret file)
  --hours N   stop by itself after N hours (default 8, the time an agent connection lives; 0.5 is fine)
  --port N    the local port (default: a free one)
  --help      this text

It prints one line, "Link for the test: https://....trycloudflare.com", once the page loads, /mcp refuses a call
with no token and the relay works. Anyone with that link can open the page while it runs.
EOF
}
bad_usage() { echo "$self: $1" >&2; usage >&2; exit 2; }

ref=""; use_here=0; hours=8; port=""
while (($#)); do
  case $1 in
    --help|-h) usage; exit 0 ;;
    --here) use_here=1 ;;
    --hours) (($# >= 2)) || bad_usage "--hours needs a number"; hours=$2; shift ;;
    --port) (($# >= 2)) || bad_usage "--port needs a number"; port=$2; shift ;;
    -*) bad_usage "unknown option $1" ;;
    *) [[ -z $ref ]] || bad_usage "one REF at most (got '$ref' and '$1')"; ref=$1 ;;
  esac
  shift
done
[[ $hours =~ ^[0-9]+(\.[0-9]+)?$ ]] && awk "BEGIN{exit !($hours > 0)}" || bad_usage "--hours must be a number above 0 (got '$hours')"
[[ -z $port ]] || { [[ $port =~ ^[0-9]+$ ]] && ((port >= 1 && port <= 65535)) || bad_usage "--port must be 1 to 65535 (got '$port')"; }
((use_here == 0)) || [[ -z $ref ]] || bad_usage "--here serves this checkout, so it takes no REF"

# The programs. The QA_TUNNEL_* variables swap in stand-ins for the tests; nothing else needs them.
wrangler_version=$(grep -o 'wrangler@[0-9][0-9.]*' "$here/package.json" 2>/dev/null | head -1)
read -ra wrangler_cmd <<<"${QA_TUNNEL_WRANGLER:-npx --yes ${wrangler_version:-wrangler@4.159.0}}"
check_cmd=(node "$here/scripts/qa-tunnel-check.mjs")
[[ -z ${QA_TUNNEL_CHECK:-} ]] || read -ra check_cmd <<<"$QA_TUNNEL_CHECK"
cloudflared=${QA_TUNNEL_CLOUDFLARED:-$(command -v cloudflared || true)}
[[ -n $cloudflared || ! -x $HOME/.local/bin/cloudflared ]] || cloudflared=$HOME/.local/bin/cloudflared
[[ -n $cloudflared ]] || { echo "$self: cloudflared is not installed (it is a single file from Cloudflare; no account needed)." >&2; exit 1; }
command -v node >/dev/null || { echo "$self: node is not installed." >&2; exit 1; }
# The build and the self-check need Node 24.2 or newer (import.meta.main, a built-in WebSocket).
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 24 || (a === 24 && b >= 2) ? 0 : 1)' ||
  { echo "$self: Node 24.2 or newer is needed (this is $(node -v))." >&2; exit 1; }
command -v curl >/dev/null || { echo "$self: curl is not installed." >&2; exit 1; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/producer-qa-tunnel.XXXXXX") || exit 1
tree=""; made_tree=0; wr_pid=""; cf_pid=""; started=0; link_shown=0

# Stops a program and everything it started (its process group): politely, then for sure.
stop_group() {
  local pid=$1 i
  [[ -n $pid ]] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for ((i = 0; i < 50; i++)); do kill -0 -- "-$pid" 2>/dev/null || kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  { wait "$pid"; } 2>/dev/null || true
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  stop_group "$cf_pid"
  stop_group "$wr_pid"
  if ((made_tree)); then
    git -C "$here" worktree remove --force "$tree" 2>/dev/null || true
    git -C "$here" worktree prune 2>/dev/null || true
  fi
  rm -rf "$tmp"
  if ((started)); then
    local said="the tunnel and the local Worker are off"
    ((made_tree)) && said+=" and the temporary copy is removed" || said+="; your checkout was left as it was"
    ((link_shown)) && said+=". The link no longer works"
    echo "Stopped: $said."
  fi
  exit "$status"
}
# Ctrl+C, a stop signal and a closed terminal are the normal ways to end this: they exit cleanly.
trap cleanup EXIT
trap 'exit 0' INT TERM HUP

die() { echo "$self: $1" >&2; exit 1; }
tail_of() { [[ -s $1 ]] && tail -n 12 "$1" | sed "s/^/  $2: /" >&2; true; }

# Secret files wrangler would load or the page tree (dist/, which the tunnel serves) would hold. The same names the repo guard refuses.
secret_files() {
  find "$1" \( -name .git -o -name node_modules -o -name .wrangler -o -name .scratch \) -prune -o \( -type f -o -type l \) \
    \( -name '.env' -o -name '.env.*' -o -name '*.key' -o -name '*.pem' -o -name '.dev.vars' -o -name '.dev.vars.*' \) -print |
    sed "s|^$1/||"
}

# What is served: this checkout, or a temporary copy of a ref (default: the latest origin/dev).
if ((use_here)); then
  tree=$here
  commit=$(git -C "$here" rev-parse --short=7 HEAD 2>/dev/null || echo "no commit")
  if [[ -n $(git -C "$here" status --porcelain 2>/dev/null) ]]; then serving="this checkout, with changes not yet committed (from $commit)"; else serving="this checkout ($commit)"; fi
else
  # The newest copy on GitHub wins over a local branch of the same name, which may be out of date.
  git -C "$here" fetch -q origin 2>/dev/null || echo "$self: could not fetch from GitHub; using the copies this computer already has." >&2
  [[ -n $ref ]] || ref=dev
  # Only a plain branch name looks at GitHub's copy: HEAD, HEAD~1 and the like mean this checkout (origin/HEAD is GitHub's default branch).
  if [[ $ref != HEAD && $ref != *[~^@:]* ]] && git -C "$here" show-ref --verify --quiet "refs/remotes/origin/$ref" &&
    full=$(git -C "$here" rev-parse --verify --quiet "refs/remotes/origin/$ref^{commit}"); then label=origin/$ref
  elif full=$(git -C "$here" rev-parse --verify --quiet "$ref^{commit}"); then label=$ref
  elif [[ $ref =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] && git -C "$here" fetch -q origin "$ref" 2>/dev/null && full=$(git -C "$here" rev-parse --verify --quiet FETCH_HEAD^{commit}); then label=$ref
  else die "no such branch, tag or commit: $ref"
  fi
  commit=$(git -C "$here" rev-parse --short=7 "$full")
  tree=$tmp/tree
  git -C "$here" worktree add --detach -q "$tree" "$full" || die "could not make a temporary copy of $label"
  made_tree=1
  serving="$label ($commit), in a temporary copy"
fi

found=$(secret_files "$tree") || die "could not look through $tree for secret files (a folder that cannot be read?); nothing was started"
if [[ -n $found ]]; then
  {
    echo "$self: refusing to start: this repo holds a secret file:"
    sed 's/^/  /' <<<"$found"
    echo "Take it out of this folder (and off the branch) and run again. Nothing was started."
  } >&2
  exit 1
fi

# A port someone else already uses would answer the readiness check, and the tunnel would then open to that program.
[[ -z $port ]] || node -e 'const s=require("net").createServer();s.on("error",()=>process.exit(1));s.listen(+process.argv[1],"127.0.0.1",()=>s.close())' "$port" ||
  die "port $port is already in use on this computer; pick another with --port, or leave it out"
[[ -n $port ]] || port=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})') || die "no free local port"

# Wrangler gets no --host or --local-upstream on purpose, and the Worker still sees the tunnel's own address as its origin,
# which is what its Origin check (src/worker.mjs, foreign) compares a browser's Origin with. Checked on a real quick tunnel
# on 2026-11-09 (wrangler 4.159.0, cloudflared 2026.9.3): POST /api/agent-token with Origin set to the tunnel address
# answered 200, with another Origin 403, and the relay socket opened with that Origin. The self-check below sends the
# same Origin on the token request and on the socket, so if a newer wrangler or cloudflared ever changes this, the
# check fails and no link is printed.
# 1. The Worker, on this computer only. The preview build keeps search engines out (noindex header, robots.txt).
#    No Cloudflare login or token: whatever the shell holds is taken away from wrangler, so it cannot reach an account.
started=1
t_start=$SECONDS
(
  cd "$tree" || exit 1
  exec ${own[@]+"${own[@]}"} env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u CLOUDFLARE_API_KEY -u CLOUDFLARE_EMAIL WRANGLER_SEND_METRICS=false \
    "${wrangler_cmd[@]}" dev --local --env preview --ip 127.0.0.1 --port "$port" --persist-to "$tmp/state" --show-interactive-dev-session=false
) >"$tmp/wrangler.log" 2>&1 &
wr_pid=$!
echo "Starting the producer on this computer (the first run downloads the speech model and takes longer)..."
until curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; do
  kill -0 "$wr_pid" 2>/dev/null || { tail_of "$tmp/wrangler.log" wrangler; die "the local Worker stopped before it was ready"; }
  ((SECONDS - t_start < 240)) || { tail_of "$tmp/wrangler.log" wrangler; die "the local Worker was not ready after 240 s"; }
  sleep 0.2
done
t_worker=$((SECONDS - t_start))

# 2. A Cloudflare quick tunnel to it: no account, a random address that lives only while this runs.
echo "Opening the tunnel..."
# Cloudflare does not support quick tunnels on a computer that has a cloudflared config file (a named tunnel).
cf_hint=""
for config in "$HOME/.cloudflared/config.yml" "$HOME/.cloudflared/config.yaml"; do
  [[ ! -e $config ]] || cf_hint=" (a cloudflared config file exists at $config; quick tunnels do not start while it does: move it aside while testing)"
done
${own[@]+"${own[@]}"} env -u TUNNEL_TOKEN -u TUNNEL_TOKEN_FILE -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID "$cloudflared" tunnel --no-autoupdate --metrics 127.0.0.1:0 --url "http://127.0.0.1:$port" >"$tmp/cloudflared.log" 2>&1 &
cf_pid=$!
t_tunnel_start=$SECONDS
url=""
until [[ -n $url ]]; do
  url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$tmp/cloudflared.log" 2>/dev/null | grep -v '^https://api\.' | head -1)
  [[ -z $url ]] || break
  kill -0 "$cf_pid" 2>/dev/null || { tail_of "$tmp/cloudflared.log" cloudflared; die "cloudflared stopped before it gave an address$cf_hint"; }
  ((SECONDS - t_tunnel_start < 60)) || { tail_of "$tmp/cloudflared.log" cloudflared; die "cloudflared gave no address after 60 s$cf_hint"; }
  sleep 0.2
done
# The address is printed before the tunnel is connected. Asking for it earlier makes the local name lookup fail,
# and that failure can be remembered for a long while, so wait until cloudflared says it is connected.
until grep -q 'Registered tunnel connection' "$tmp/cloudflared.log" 2>/dev/null; do
  kill -0 "$cf_pid" 2>/dev/null || { tail_of "$tmp/cloudflared.log" cloudflared; die "cloudflared stopped before the tunnel was connected"; }
  ((SECONDS - t_tunnel_start < 60)) || { tail_of "$tmp/cloudflared.log" cloudflared; die "the tunnel was not connected after 60 s"; }
  sleep 0.2
done
t_tunnel=$((SECONDS - t_tunnel_start))

# 3. Ask the public address itself, so the whole way through the tunnel is tested before anyone is given the link.
t_check_start=$SECONDS
"${check_cmd[@]}" "$url" || { tail_of "$tmp/cloudflared.log" cloudflared; die "the self-check failed; no link is given"; }
t_check=$((SECONDS - t_check_start))

seconds_limit=$(awk "BEGIN{s=int($hours*3600); print (s < 1 ? 1 : s)}")
echo
link_shown=1
echo "Link for the test: $url"
echo "  Anyone with this link can open the page while it runs. The page stores nothing."
echo "  Serving $serving. Search engines are asked to stay away."
echo "  Ready in $((SECONDS - t_start)) s (Worker $t_worker s, tunnel $t_tunnel s, checks $t_check s)."
stop_at=$(date -d "+$seconds_limit seconds" +%H:%M 2>/dev/null || date -v+"${seconds_limit}S" +%H:%M 2>/dev/null || echo "$hours hours from now")
if ((made_tree)); then gone="Both programs and the temporary copy are removed then."; else gone="Both programs stop then; your checkout is left as it is."; fi
echo "  Stops by itself at $stop_at ($hours hours), or press Ctrl+C. $gone"
echo

end=$((SECONDS + seconds_limit))
while ((SECONDS < end)); do
  kill -0 "$wr_pid" 2>/dev/null || { tail_of "$tmp/wrangler.log" wrangler; die "the local Worker stopped; the link no longer works"; }
  kill -0 "$cf_pid" 2>/dev/null || { tail_of "$tmp/cloudflared.log" cloudflared; die "the tunnel stopped; the link no longer works"; }
  sleep 1 &
  wait $!
done
echo "Time limit reached."
