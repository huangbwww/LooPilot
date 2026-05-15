# LooPilot

Codex Desktop 会话的手机端伴侣。

语言：[English](README.md) | 简体中文

## 我为什么做这个

我做 LooPilot 的初衷，和很多类似工具的开发者差不多：希望中午吃饭、晚上回家、或者临时离开 Windows 工作机的时候，也能用手机看一眼 Codex 的工作情况，必要时继续对话或处理授权。名字本身也有一点玩笑意味。它可以理解成 `loop pilot`，像一个帮你维持 Codex 工作循环的小领航员；也可以理解成 `loo pilot`，毕竟有时候真实场景就是离开工位时顺手看一眼 Codex 还在不在干活，甚至上个厕所也想确认它有没有继续推进，哈哈哈 😄。

在开始写之前，我试过 Happy、Hapi、Remodex 以及一些类似项目。它们都有价值，但和我自己的使用环境不完全贴合。我目前主要是 Android + Windows，同时会用 Codex Desktop 和 CLI，而且现在桌面端使用频率更高。我想要的不是一个单纯的远程 CLI 面板，而是更接近“手机版 Codex Desktop”的东西：按项目分组的会话列表、实时会话状态、授权/选择提醒、模型和推理强度控制，以及从手机继续当前桌面会话的能力。

现在官方已经在 iPhone + Mac 组合上开始支持移动端体验了，这个方向本身挺让人期待，也让我更希望 Android + Windows 能尽快获得同等级的官方支持。在那之前，LooPilot 就算是我给自己这个日常组合先垫上的一个小补丁。

不过测试一段时间后，我也越来越清楚这个方向的边界。很多真实开发场景仍然需要配合 Windows 机器看效果：看本地运行的应用、检查 UI 改动、观察预览窗口、处理一些只有桌面环境里才有意义的工具反馈。手机端更适合看进度、催一下 Codex、处理授权、补一句需求，或者顺手改一个小点。它并不能真正替代坐在电脑前开发。

这里还有一个同步上的取舍。LooPilot 发送的消息会通过本地 `codex app-server` bridge 和本地 session 文件进入 Codex 会话，因此 LooPilot 自己可以记录和跟进这些消息；但 Codex Desktop 官方窗口并不总是会把这种外部启动的 turn 像你直接在桌面 UI 输入一样实时显示出来。如果目标是在外面用手机完整操作 Codex 并且要看到全部视觉反馈，手机远程桌面有时候反而更直接。现在手机输入法语音转文字也很好用，远程桌面里直接语音输入并不麻烦，这也是 LooPilot 没有再单独做语音输入的原因。

所以 LooPilot 暂时会停留在一个“实用伴侣”的定位，而不是完美的移动版 Codex。它对我自己的“看一眼、推一把、处理一下授权”工作流已经够用。也许有人正好有类似的 Android + Windows 使用场景，可以拿去试试；如果遇到问题或有更适合的工作流，欢迎提 Issue。

## 运行

不下载源码，直接运行：

```bash
npx loopilot
```

通过临时 Cloudflare Tunnel 获取公网地址：

```bash
npx loopilot --public
```

Safe mode 只把手机消息放入队列，不启动 Codex bridge 进程：

```bash
npx loopilot --safe
```

从源码运行：

```bash
npm install
npm run dev
```

服务启动后会打印一个包含本地访问 token 的 `Authorized URL`，以及一个 6 位配对码。手机端优先输入配对码；浏览器会拿到并保存设备 token。随机配对码在成功配对后会自动轮换。你也可以直接把完整 token 粘贴到登录框。

当 Codex 会话需要确认、授权或选择时，PWA 会在对应会话里显示待处理请求；手机浏览器授权通知权限后，也可以使用浏览器通知和震动提醒。

从源码运行 safe mode：

```bash
npm run dev:safe
```

本地一键验收检查：

```bash
npm run accept:safe
```

这个命令会启动 safe mode、使用测试配对码配对、读取本地 Codex 会话、验证 WebSocket 快照，然后停止服务。

## 公网访问

从源码运行公网模式：

```bash
npm run dev:public
```

`dev:public` 会启动应用，并在第一次运行时把私有的 `cloudflared` 二进制下载到 LooPilot 状态目录，然后打印一个 `trycloudflare.com` 公网地址。手机端用启动时打印的配对码登录即可。这个 tunnel 使用 HTTP/2 模式。

公网模式的一键验收检查：

```bash
npm run accept:public
```

`accept:public` 会启动 `--public`，等待 `trycloudflare.com` 地址，验证本地 health、配对、sessions 和 WebSocket 快照，然后停止服务。它可能会下载并运行 `cloudflared`；如果你不想启动外部进程，用 `accept:safe`。

## Codex bridge 验收

运行真实的 Codex app-server bridge 验收前，需要显式指定目标会话：

```bash
$env:LOOPILOT_ACCEPT_SESSION_ID = "<session-id>"
npm run accept:bridge
```

`accept:bridge` 会通过 app-server bridge 发送一条短消息，并禁用 CLI fallback。这样 app-server bridge 失败时会直接让验收失败，而不是再启动 `codex resume`。只有在确认最新会话就是目标会话时，才使用 `LOOPILOT_ACCEPT_USE_LATEST=1`。

LooPilot 会读取 `~/.codex` 下的 Codex Desktop session JSONL 文件，把变化推送到 Web UI，并通过本地 `codex app-server` WebSocket bridge 发送手机端消息。Bridge 活动也会记录在 LooPilot 状态目录里。

默认本地地址：`http://localhost:4317`。

验收流程记录在 `docs/ACCEPTANCE_RUNBOOK.md`。

## 注意事项

- 访问 token 存在 LooPilot 状态目录，也可以用 `LOOPILOT_TOKEN` 指定。
- 配对码存在 LooPilot 状态目录，也可以用 `LOOPILOT_PAIRING_CODE` 指定。
- 默认状态目录是项目下的 `.loopilot`；如果不可写，会回退到用户状态目录，再回退到系统临时目录。可以用 `LOOPILOT_STATE_DIR` 显式指定。
- 设置 `LOOPILOT_BRIDGE_MODE=queue` 后，发送手机消息时只测试手机 UI，不启动 `codex app-server` 或 `codex resume`。
- 生产构建输出到 `build/`。
- 设置 `LOOPILOT_ENABLE_CLI_FALLBACK=1` 可以在 app-server bridge 失败时允许 `codex resume` fallback。默认禁用，以避免 app-server 部分失败后造成重复发送。Windows 上 fallback 会拒绝 `.cmd` shell wrapper；如果确实需要 fallback，请把 `LOOPILOT_CODEX_COMMAND` 设置成真实的 `codex.exe`。
- 不要随意分享公网 URL。服务运行期间，这个 URL 可以控制本地 Codex 会话。
