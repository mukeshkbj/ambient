#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failed=0

report() {
  if [ -n "$2" ]; then echo "entry $1: reproduced: $2"; else echo "entry $1: NOT reproduced"; failed=1; fi
}

page() {
  curl -sSL "$1" | sed 's/<[^>]*>//g; s/\\"/"/g; s/`//g; s/&quot;/"/g'
}

alexa=https://developer.amazon.com/docs/alexaplus/add-ons
aai=https://www.assemblyai.com/docs/voice-agents/voice-agent-api

mkdir -p "$root/.ambient/repro"
awk '/^`elicit.mts` for entry 1/{f=1} f&&/^```ts$/{g=1;next} g&&/^```$/{exit} g{print}' "$root/docs/friction-log.md" > "$root/.ambient/repro/elicit.mts"
modes=""
for mode in json sse sse-related json-related; do
  out="$(cd "$root/.ambient/repro" && timeout 20 node --import tsx elicit.mts "$mode" 2>&1)"
  if echo "$out" | grep -q "elicitation/create"; then modes="$modes $mode:delivered"; else modes="$modes $mode:silent"; fi
done
rm -rf "$root/.ambient/repro"
[ "$modes" = " json:silent sse:silent sse-related:delivered json-related:silent" ] && report 1 "elicitInput frame per mode:$modes" || report 1 ""

mkdir "$work/pnpm" && cd "$work/pnpm"
printf '%s\n' '{ "name": "repro", "private": true, "packageManager": "pnpm@10.33.0",' '  "scripts": { "demo": "AMBIENT_HOST=127.0.0.1 node -e \"console.log(process.env.AMBIENT_HOST)\"" } }' > package.json
out="$(pnpm demo 2>&1)"
if echo "$out" | grep -q "127.0.0.1$"; then report 2 ""; else report 2 "$(echo "$out" | grep -m1 -o "'AMBIENT_HOST' is not recognized[^,]*")"; fi
cd "$root"

versions="$(page "$alexa/mcp-toolkit-client-lifecycle.html" | grep -oE '"protocolVersion": ?"[0-9-]+"' | sort -u | tr -d '\n') $(page "$alexa/mcp-toolkit-overview.html" | grep -oE 'supports the 2025-11-25 version' | sort -u) $(page "$alexa/mcp-toolkit-local-inspector" | grep -oE '"protocolVersion": ?"[0-9-]+"' | sort -u | tr -d '\n')"
echo "$versions" | grep -q 2025-03-26 && echo "$versions" | grep -q 2025-11-25 && echo "$versions" | grep -q 2025-06-18 && report 3 "$versions" || report 3 ""

report 4 "$(page "$alexa/mcp-toolkit-authentication.html" | grep -oE 'WWW-Authenticate.{0,40}headers in 401 responses' | sort -u | head -1)"

lifecycle="$(page "$alexa/mcp-toolkit-client-lifecycle.html" | grep -oE 'resourceUri.{0,10}defined in the tool response' | sort -u | head -1)"
spec="$(curl -sSL https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx | grep -c '_meta.ui')"
[ -n "$lifecycle" ] && [ "$spec" -gt 0 ] && report 5 "Alexa: \"$lifecycle\"; MCP Apps spec: _meta.ui on the tool ($spec mentions)" || report 5 ""

curl -sSL "$aai/connect-your-own-llm.md" -o "$work/byo.md"
shape="$(grep -c 'POST {base_url}/chat/completions' "$work/byo.md")"
body="$(grep -ciE 'messages|timeout|tools' "$work/byo.md")"
[ "$shape" -gt 0 ] && [ "$body" -eq 0 ] && report 6 "the page names POST {base_url}/chat/completions and never mentions messages, timeout or tools" || report 6 ""

curl -sSL "$aai/events-reference.md" -o "$work/ev.md"
curl -sSL "$aai/message-sequence.md" -o "$work/seq.md"
delta="$(grep -c '"delta"' "$work/seq.md")"
replyid="$(grep -A3 '"type": "reply.started"' "$work/ev.md" | grep -c reply_id)"
bare="$(grep -c '{ "type": "reply.started" }' "$work/seq.md")"
example="$(curl -sSL https://raw.githubusercontent.com/AssemblyAI/voice-agent-api-twilio-example/main/src/index.ts | grep -o 'v1/realtime' | head -1)"
[ "$delta" -gt 0 ] && [ "$replyid" -gt 0 ] && [ "$bare" -gt 0 ] && [ -n "$example" ] && report 7 "reply.started has reply_id in one page and none in the other; the example repository uses /v1/realtime" || report 7 ""

report 8 "$(grep -oE 'agent_id_not_first' "$work/ev.md" | head -1)$(grep -q 'mutually exclusive with the inline fields' "$work/ev.md" && echo ': agent_id is mutually exclusive with the inline fields')"

printf '%s\n' 'console.log(import.meta.url); console.log(process.argv[1]);' 'if (import.meta.url === `file://${process.argv[1]}`) console.log("guard: match"); else console.log("guard: no match");' > "$work/main.mjs"
report B "$(node "$work/main.mjs" | grep -o 'guard: no match')"

printf '%s\n' 'const turns: number[] = [1, 2, 3];' 'export const last = turns.findLast(n => n > 1);' > "$work/fl.ts"
report C "$("$root/node_modules/.bin/tsc" --noEmit --target ES2022 --lib ES2022 "$work/fl.ts" 2>&1 | grep -o 'TS2550' | head -1)"

exit "$failed"
