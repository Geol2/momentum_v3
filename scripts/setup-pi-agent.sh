#!/usr/bin/env bash
# 라즈베리파이를 "항상 켜진 PC"로 — Claude Code + pc-agent 서비스 한 번에 설정.
# 파이에서:  bash <(curl -fsSL https://raw.githubusercontent.com/Geol2/momentum_v3/main/scripts/setup-pi-agent.sh)
#      또는  bash ~/work/momentum_v3/scripts/setup-pi-agent.sh
# 중간에 묻는 것: sudo 비밀번호, Claude 로그인(/login), (비공개 저장소면) GitHub 토큰, 모멘텀 이메일·비밀번호
set -euo pipefail

say() { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
WORK="$HOME/work"
REPOS=("momentum_v3" "Integration-api-backend")
NAME="${AGENT_NAME:-라즈베리파이}"

say "1/7 스왑 2GB"
if [ -f /etc/dphys-swapfile ]; then
  sudo sed -i 's/^#\?CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/; s/^#\?CONF_MAXSWAP=.*/CONF_MAXSWAP=2048/' /etc/dphys-swapfile
  grep -q '^CONF_MAXSWAP=' /etc/dphys-swapfile || echo 'CONF_MAXSWAP=2048' | sudo tee -a /etc/dphys-swapfile >/dev/null
  sudo dphys-swapfile swapoff || true
  sudo dphys-swapfile setup && sudo dphys-swapfile swapon
fi
free -h | grep -i swap

say "2/7 Node (18 이상)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

say "3/7 Claude Code"
export PATH="$HOME/.local/bin:$PATH"
if ! command -v claude >/dev/null; then
  curl -fsSL https://claude.ai/install.sh | bash
  grep -q '.local/bin' ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
fi
unset ANTHROPIC_API_KEY || true
if ! claude -p "ok" >/dev/null 2>&1; then
  echo "Claude Code 로그인이 필요해요. 곧 열리는 화면에서 /login → 링크를 폰·PC에서 열어 로그인 → 코드 붙여넣기 → /exit"
  read -rp "준비되면 Enter... " _
  claude
fi

say "4/7 저장소 받기 ($WORK)"
mkdir -p "$WORK"
for r in "${REPOS[@]}"; do
  if [ -d "$WORK/$r/.git" ]; then git -C "$WORK/$r" pull --ff-only || true
  else git clone "https://github.com/Geol2/$r.git" "$WORK/$r"; fi
done

say "5/7 폴더마다 Claude Code 세션 한 번 (pc-agent 가 이 폴더들을 모멘텀에 보여 줌)"
for r in "${REPOS[@]}"; do
  (cd "$WORK/$r" && claude -p "이 프로젝트를 한 줄로 요약해 줘" | head -3) || echo "($r 세션 만들기 실패 — 나중에 그 폴더에서 claude 한 번 실행)"
done

say "6/7 모멘텀 로그인 정보 (~/.momentum.env)"
if [ ! -s "$HOME/.momentum.env" ]; then
  read -rp "모멘텀 이메일: " ME
  read -rsp "모멘텀 비밀번호: " MP; echo
  umask 077
  printf "MOMENTUM_EMAIL=%s\nMOMENTUM_PASSWORD='%s'\n" "$ME" "${MP//\'/}" > "$HOME/.momentum.env"
fi
chmod 600 "$HOME/.momentum.env"

say "7/7 pc-agent 서비스"
sudo tee /etc/systemd/system/momentum-pc-agent.service >/dev/null <<EOF
[Unit]
Description=Momentum PC agent (Claude Code, 읽기 전용)
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$WORK/momentum_v3
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStartPre=-/usr/bin/git -C $WORK/momentum_v3 pull --ff-only
ExecStart=$(command -v node) scripts/pc-agent.mjs --name $NAME
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now momentum-pc-agent
sleep 4
journalctl -u momentum-pc-agent -n 5 --no-pager

say "끝! 모멘텀 Claude Code 탭 → '+ PC에서 새 대화'에 '$NAME'이 보이면 성공이에요."
