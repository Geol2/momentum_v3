// 우주 탐험 — universe-explorer.js에서 분리한 모듈 (동작 동일)

// ───────────────────────── 스타일 ─────────────────────────
const STYLE_ID = 'mu-universe-style';
const CSS = `
.mu-root{--g:#3dff8f;--g2:rgba(61,255,143,.55);--g3:rgba(61,255,143,.18);--gd:#a6ffcb;
  --glow:0 0 4px rgba(61,255,143,.9),0 0 12px rgba(61,255,143,.45);
  position:absolute;inset:0;overflow:hidden;background:#010604;color:var(--gd);
  font-family:"SF Mono",Menlo,Consolas,"D2Coding","Apple SD Gothic Neo","Noto Sans KR",monospace;
  user-select:none;-webkit-user-select:none;touch-action:none}
.mu-root::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:5;
  background:repeating-linear-gradient(0deg,rgba(61,255,143,.035) 0 1px,transparent 1px 3px),
  radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.55) 100%)}
.mu-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.mu-overlay{cursor:crosshair;touch-action:none}
.mu-overlay:active{cursor:grabbing}
.mu-frame{position:relative;background:
  linear-gradient(var(--g),var(--g)) left top/14px 2px no-repeat,linear-gradient(var(--g),var(--g)) left top/2px 14px no-repeat,
  linear-gradient(var(--g),var(--g)) right top/14px 2px no-repeat,linear-gradient(var(--g),var(--g)) right top/2px 14px no-repeat,
  linear-gradient(var(--g),var(--g)) left bottom/14px 2px no-repeat,linear-gradient(var(--g),var(--g)) left bottom/2px 14px no-repeat,
  linear-gradient(var(--g),var(--g)) right bottom/14px 2px no-repeat,linear-gradient(var(--g),var(--g)) right bottom/2px 14px no-repeat,
  rgba(1,18,9,.62);
  border:1px solid var(--g3);box-shadow:inset 0 0 22px rgba(61,255,143,.08),0 0 14px rgba(61,255,143,.12);backdrop-filter:blur(3px)}
.mu-top{position:absolute;top:10px;left:10px;right:58px;padding:7px 10px 8px;pointer-events:none;z-index:6;max-width:400px}
.mu-title{font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--g);text-shadow:var(--glow)}
.mu-step{display:inline-block;font-size:10px;font-weight:700;padding:1px 6px;margin-right:8px;letter-spacing:.12em;
  border:1px solid var(--g2);color:var(--g);vertical-align:3px;text-shadow:var(--glow)}
.mu-desc{margin-top:6px;font-size:10.5px;line-height:1.45;color:var(--gd);opacity:.92;text-shadow:0 0 6px rgba(61,255,143,.35)}
.mu-close{position:absolute;top:10px;right:10px;width:38px;height:38px;z-index:6;border:1px solid var(--g2);
  background:rgba(1,18,9,.7);color:var(--g);font-weight:700;font-size:12px;cursor:pointer;text-shadow:var(--glow);
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);box-shadow:inset 0 0 10px rgba(61,255,143,.25)}
.mu-3d{position:absolute;top:56px;right:10px;width:38px;height:38px;z-index:6;border:1px solid var(--g2);padding:0;
  background:rgba(1,18,9,.7);color:var(--g);font-family:inherit;font-weight:800;font-size:11px;cursor:pointer;text-shadow:var(--glow);
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);box-shadow:inset 0 0 10px rgba(61,255,143,.25);
  animation:mu3dpulse 2.4s ease-in-out infinite}
.mu-3d[hidden]{display:none}
.mu-more{top:148px;animation:none;font-size:10.5px}
.mu-snd{top:102px;animation:none;font-size:12px;opacity:.6}
.mu-sky{top:194px;animation:none;font-size:10px;letter-spacing:.02em}
.mu-trip{top:240px;animation:none;font-size:10px;letter-spacing:0}
.mu-plan{animation:none;font-size:10px;letter-spacing:0}
.mu-today{top:286px;animation:none;font-size:10px;letter-spacing:0}
.mu-find{top:332px;animation:none;font-size:10px;letter-spacing:0}
.mu-menu{position:absolute;top:56px;right:10px;width:38px;height:38px;z-index:7;border:1px solid var(--g2);padding:0;
  background:rgba(1,18,9,.7);color:var(--g);font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;text-shadow:var(--glow);
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);box-shadow:inset 0 0 10px rgba(61,255,143,.25)}
.mu-menu.on{background:rgba(61,255,143,.3);color:#eafff2}
.mu-menu.ping::after{content:'';position:absolute;top:5px;right:5px;width:6px;height:6px;background:var(--g);box-shadow:0 0 6px var(--g)}
.mu-q3{position:absolute;top:102px;right:10px;width:38px;height:38px;z-index:7;border:1px solid var(--g);padding:0;
  background:rgba(1,30,14,.8);color:var(--g);font-family:inherit;font-weight:800;font-size:12px;letter-spacing:.02em;cursor:pointer;text-shadow:var(--glow);
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);box-shadow:inset 0 0 12px rgba(61,255,143,.45)}
.mu-q3.on{background:rgba(61,255,143,.3);color:#eafff2}
.mu-tools{position:absolute;top:148px;right:10px;z-index:7;display:flex;flex-flow:column wrap;align-items:flex-end;align-content:flex-end;gap:6px;max-height:calc(100% - 230px)}
.mu-tools:not(.open){display:none}
.mu-tools .mu-3d{position:relative;top:auto;right:auto;width:auto;min-width:38px;height:34px;padding:0 10px;animation:none;opacity:1;font-size:10.5px;letter-spacing:.02em;white-space:nowrap}
.mu-tools .mu-3d::after{content:attr(data-label);margin-left:6px;font-weight:700;color:#cfffe2}
.mu-findbox{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:min(340px,calc(100% - 120px));z-index:9;padding:8px}
.mu-findbox[hidden]{display:none}
.mu-findbox input{width:100%;box-sizing:border-box;background:rgba(0,0,0,.5);border:1px solid var(--g2);color:#eafff2;font:inherit;font-size:12px;padding:7px 8px;outline:none}
.mu-findlist{max-height:260px;overflow:auto;margin-top:6px}
.mu-findlist button{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid rgba(61,255,143,.12);color:var(--g);font:inherit;font-size:11px;padding:6px 4px;cursor:pointer}
.mu-findlist button span{color:var(--gd);font-size:10px;margin-left:6px}
.mu-findlist .none{color:var(--gd);font-size:10.5px;padding:6px 4px}
.mu-photo{position:absolute;z-index:7;width:180px;padding:4px 4px 3px;pointer-events:none;background:rgba(1,18,9,.92)}
.mu-photo[hidden]{display:none}
.mu-photo img{display:block;width:100%;max-height:180px;object-fit:cover;border:1px solid rgba(61,255,143,.35)}
.mu-photo span{display:block;font-size:10px;color:rgba(166,255,203,.7);margin-top:2px;text-align:right}
.mu-warp{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom));z-index:8;border:1px solid var(--g);background:rgba(61,255,143,.22);
  color:#eafff2;font-family:inherit;font-weight:800;font-size:11px;letter-spacing:.08em;padding:9px 16px;cursor:pointer;text-shadow:var(--glow);
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);animation:mu3dpulse 1.6s ease-in-out infinite}
.mu-warp[hidden]{display:none}
.mu-snd.on{opacity:1;background:rgba(61,255,143,.3);color:#eafff2}
.mu-more.on{background:rgba(61,255,143,.3);color:#eafff2}
@keyframes mu3dpulse{50%{box-shadow:inset 0 0 14px rgba(61,255,143,.55),0 0 12px rgba(61,255,143,.5)}}
.mu-bottom{position:absolute;left:0;right:0;bottom:0;padding:0 12px calc(12px + env(safe-area-inset-bottom));z-index:6;
  background:linear-gradient(transparent,rgba(1,6,4,.9) 45%)}
.mu-focusbar{display:flex;justify-content:center;gap:6px;margin-bottom:6px}
.mu-focusbar[hidden]{display:none}
.mu-focusbar button,.mu-controls button,.mu-card button{border:1px solid var(--g2);background:rgba(1,22,11,.75);color:var(--g);
  font-family:inherit;font-weight:700;font-size:11px;letter-spacing:.06em;cursor:pointer;text-shadow:var(--glow);touch-action:none;
  clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px);box-shadow:inset 0 0 10px rgba(61,255,143,.2)}
.mu-focusbar button{padding:5px 11px;font-size:10.5px}
.mu-focusbar button:active,.mu-controls button:active,.mu-card button:active{background:rgba(61,255,143,.25)}
.mu-credit{font-size:10px;line-height:1.35;color:rgba(166,255,203,.55);text-align:center;margin:0 auto 6px;max-width:400px}
.mu-credit a{color:rgba(166,255,203,.8)}
.mu-scale{font-size:10.5px;color:var(--gd);opacity:.85;margin-bottom:8px;text-align:center;font-variant-numeric:tabular-nums;letter-spacing:.04em}
.mu-scale b{color:var(--g);font-weight:700;text-shadow:var(--glow)}
.mu-controls{display:flex;align-items:flex-end;gap:5px;max-width:440px;margin:0 auto}
.mu-controls>button{flex:none;width:36px;height:30px;font-size:12px}
.mu-slider{flex:1;accent-color:#3dff8f;height:28px;filter:drop-shadow(0 0 4px rgba(61,255,143,.6))}
.mu-where{margin-top:5px;font-size:10px;line-height:1.4;color:#9ff0d6;letter-spacing:.02em;text-shadow:0 0 4px rgba(61,255,143,.4)}
.mu-where b{color:var(--g);font-weight:700}
.mu-ladder{position:relative;flex:1;min-width:0;display:flex;gap:2px;padding-top:7px;touch-action:none;cursor:ew-resize}
.mu-lv{flex:1;min-width:0;height:23px;pointer-events:none;padding:0;border:1px solid var(--g3);background:rgba(1,18,9,.7);color:rgba(61,255,143,.45);font:inherit;font-size:10px;font-weight:700;cursor:pointer;font-variant-numeric:tabular-nums}
.mu-lv.found{background:rgba(61,255,143,.16);color:var(--g);border-color:var(--g2)}
.mu-lv.cur{background:rgba(61,255,143,.42);color:#eafff2;border-color:var(--g);box-shadow:0 0 8px rgba(61,255,143,.6);text-shadow:0 0 3px #000}
.mu-lvmark{position:absolute;top:0;left:0;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--g);filter:drop-shadow(0 0 3px var(--g));transform:translateX(-5px);transition:left .12s linear}
.mu-citybtn{position:absolute;right:14px;bottom:100%;margin-bottom:8px;height:30px;padding:0 12px;border:1px solid var(--g2);background:rgba(1,22,11,.82);color:var(--g);
  font-family:inherit;font-weight:700;font-size:11px;letter-spacing:.04em;cursor:pointer;box-shadow:0 0 10px rgba(61,255,143,.35);text-shadow:var(--glow)}
.mu-citybtn[hidden]{display:none}
.mu-tiltbtn{position:absolute;right:14px;bottom:100%;margin-bottom:8px;height:30px;padding:0 12px;border:1px solid var(--g2);background:rgba(1,22,11,.82);color:var(--g);
  font-family:inherit;font-weight:700;font-size:11px;cursor:pointer;text-shadow:var(--glow)}
.mu-tiltbtn[hidden]{display:none}
.mu-scalebar{position:absolute;left:14px;bottom:100%;margin-bottom:8px;display:flex;flex-direction:column;align-items:flex-start;gap:2px;pointer-events:none;
  font-size:10px;color:#cfffe2;text-shadow:0 0 3px #000,0 0 6px #000;font-variant-numeric:tabular-nums}
.mu-sb-bar{display:block;height:5px;border:1.5px solid var(--g);border-top:0;box-shadow:0 2px 4px rgba(0,0,0,.6);transition:width .12s linear}
.mu-lvtext{max-width:440px;margin:0 auto 5px;font-size:10px;text-align:center;color:var(--gd);letter-spacing:.03em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-lvtext b{color:var(--g)}
.mu-progress{position:relative;max-width:400px;margin:10px auto 0;height:16px;border:1px solid var(--g2);background:rgba(1,18,9,.7);overflow:hidden}
.mu-progress-fill{position:absolute;top:2px;bottom:2px;left:2px;width:0;transition:width .5s;
  background:repeating-linear-gradient(90deg,var(--g) 0 9px,transparent 9px 12px);box-shadow:0 0 10px rgba(61,255,143,.6)}
.mu-progress span{position:absolute;inset:0;font-size:10px;line-height:14px;text-align:center;color:#eafff2;font-weight:700;letter-spacing:.12em;
  text-shadow:0 0 3px #000,0 0 6px #000}
.mu-toast{position:absolute;left:50%;bottom:calc(112px + env(safe-area-inset-bottom));transform:translate(-50%,10px);opacity:0;transition:all .3s;z-index:25;
  padding:9px 16px;font-size:11px;font-weight:700;color:var(--g);letter-spacing:.03em;text-shadow:var(--glow);
  width:max-content;max-width:calc(100% - 32px);white-space:normal;text-align:center;pointer-events:none}
.mu-toast::before{content:'> ';opacity:.8}
.mu-toast.show{opacity:1;transform:translate(-50%,0)}
.mu-hint{position:absolute;left:50%;bottom:calc(112px + env(safe-area-inset-bottom));transform:translateX(-50%);font-size:10.5px;color:var(--g);z-index:6;
  padding:8px 14px;pointer-events:none;transition:opacity .6s;width:max-content;max-width:calc(100% - 24px);text-align:center;text-shadow:var(--glow)}
.mu-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,6,3,.7);z-index:8}
.mu-modal[hidden]{display:none}
.mu-card{width:min(360px,calc(100% - 32px));padding:22px 20px;text-align:center}
.mu-card h2{margin:0 0 4px;font-size:12px;color:var(--g);letter-spacing:.08em;text-shadow:var(--glow)}
.mu-card p{margin:0 0 14px;font-size:11px;color:var(--gd)}
.mu-addr{text-align:left;font-size:11px;line-height:1.9;padding:10px 14px;border:1px solid var(--g3);background:rgba(61,255,143,.04);margin-bottom:16px}
.mu-addr div{display:flex;gap:8px;color:var(--gd)}
.mu-addr div::before{content:'>';color:var(--g)}
.mu-addr .me{color:var(--g);font-weight:700;text-shadow:var(--glow)}
.mu-card button{margin:0 4px;padding:10px 14px}
.mu-card button.primary{background:var(--g);color:#012;text-shadow:none}
.mu-card .mu-reset{display:block;margin:12px auto 0;background:none;border:0;clip-path:none;box-shadow:none;color:rgba(166,255,203,.5);font-size:10px;text-decoration:underline;cursor:pointer}
`;

export { STYLE_ID, CSS };
