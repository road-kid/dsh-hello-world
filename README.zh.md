---
description: "在设置页头部、「打开 DSH 终端」按钮的右侧加入重启按钮，并注册 /restart 命令；一个插件、两个可单独开关的组件。"
kind: "package-bundle"
---

# dsh-hello-world

[English](README.md) | 中文

## 概述

一个插件，两个组件：

- **quick-restart** —— 在设置页头部、「打开 DSH 终端」按钮的右侧加入重启按钮，并注册 `/restart` 命令。它注册在与终端相同的官方 `settings.action` 座位里，两个动作共享同一行头部、排在「关闭」之前；不渲染设置页头部的外壳不会出现重启按钮，`/restart` 仍然可用。
- **quick-terminal** —— 在设置页右上角加入「打开 DSH 终端」，打开一个与官方桌面应用自带终端一致的 shell。

两者在插件管理页里都列在 `dsh-hello-world` 这张卡片下面，各自带开关，可以只留重启按钮、只留终端，或都关掉。命令行启动的 Host 就地重启；官方桌面应用重新启动整个应用，由应用启动新的 Host。页面会自动重新连接，只有没有任何新的 Host 应答时才出现刷新回退。

把它装入 profile：

```text
dsh plugin --profile <name> add <本包目录>
```

## 目录

- [使用此包](#use-this-package)
- [配置](#options)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 装入 profile

```text
dsh plugin --profile <name> add <本包目录>
dsh plugin --profile <name> remove dsh-hello-world
```

清单声明了 `dsh.bundle.patch`，因此 reconcile 步骤会把本包作为 profile 层激活。`cordis.patch.yml` 插入两行：`quick-restart` 与 `quick-terminal`。两行都用裸包名引用组件，因此加载器是到 profile 的包解析表里解析它们，而不是到本包目录里找。这也是两个组件同时被声明在本包 `dependencies` 里的原因（`file:` 目录，构建后链入 `node_modules`）：解析表的 profile 作用域由每个 profile 层的依赖闭包组成，未声明的组件对加载器不可见，该行会以 `ERR_MODULE_NOT_FOUND` 导入失败，对应按钮随之消失。这样声明之后，插件管理页只出现一张 `dsh-hello-world` 卡片，卡片下面却有两个各自带标题和说明的组件。随包的 profile 启用 HMR，因此运行中的 profile 会就地重新组合；只在启动时组合的 profile 在下次启动时加入该层。

### 你会得到

**重启按钮（quick-restart）。** 位于设置页头部的右端、「打开 DSH 终端」的右侧、「关闭」之前。点击后打开确认弹窗：`重启当前 DSH，自动运行新的 DSH 实例。`，并在有任务运行时说明任务数；弹窗还会列出重启要执行的那条命令，以及记录每个重启阶段的诊断日志。在输入框输入 `/restart` 可不经弹窗直接重启，`/restart --force` 忽略运行中的任务，但不绕过其他拒绝条件。

设置页头部提供了官方座位 `settings.action`。插件注册进这个座位，外壳在「关闭」之前把各个动作排成一行，因此重启按钮不需要插入 DOM、不需要每帧重排、也不需要读取头部的布局 —— 座位里的 `order`（110）就把按钮排到终端动作（100）的右侧。按钮用与终端动作相同的本地原语渲染，每个控件都是本插件自己的标记。

插件停用、进程由进程管理器管理（除非开启 `allowSupervisor`）、已附加调试器、重启已在进行中，或开启 `refuseWhileBusy` 且有任务运行时，该按钮不可用。原因会替换按钮上的文字；按钮以 `aria-disabled` 渲染而非 `disabled`，因此仍可获得焦点，屏幕阅读器也仍会朗读不可点击的原因。

重启会终止接受请求的那个 Host。客户端记下它要求替换的 pid，并每 2 秒重新读取一次状态路由；第一个带有不同 pid 的应答来自新的 Host，页面保持原有连接。25 秒内没有新的 Host 应答时，该按钮改为提供「刷新页面」。

**终端按钮（quick-terminal）。** 设置页头部提供「打开 DSH 终端」，其右侧是重启按钮（该组件开启时），最后是「关闭」。它打开一个与官方桌面应用自带终端一致的 shell —— 起始目录是 profile 目录，即 `dsh plugin --profile <name>` 作用的目标 —— 并打印同样的欢迎文字，再加上本 Host 的 pid：

```text
DeepSeek Harness 0.2.1-rc.2
Profile: desktop
DSH home: C:\Users\you\.dsh
Directory: C:\Program Files\DeepSeek Harness
Host pid: 48213 (End task: taskkill /PID 48213 /F)

Plugin commands without --profile modify the desktop profile

Commands:
  dsh --dump-config
  dsh plugin add <third-party-plugin>
  dsh plugin remove <third-party-plugin>
  dsh plugin update
```

文字按「身份 → 事实 → 说明 → 命令」排列：第一行是应用与版本，随后是每个冒号后只留一个空格的 `键: 值` 事实块，再是限定这些命令的那句话，最后是 `Commands:` 下的四条命令。事实块里每一行回答的问题都不同：`Profile:` 是这个 shell 里的 `dsh` 会改哪个 profile，`DSH home:` 是存放所有 profile 的目录，`Directory:` 是当前运行的 DSH 自己在哪里 —— 打包版的安装目录（`C:\Program Files\DeepSeek Harness`，macOS 上是 `.app` 包）、从工作副本 `dsh web` 启动时的仓库根、发布安装的 `@deepseek-ai/dsh` 包目录 —— `Host pid:` 是要结束哪个进程。profile 目录不再单独占一行：它就是 `DSH home` + `profiles` + `Profile`，单独打印只会把它周围的三行重复一遍 —— shell 仍然从那里启动，因为 `dsh plugin` 的活是在那儿干的。关于 `--profile` 的说明紧挨在它所限定的命令列表之前，因为它是那些命令的前提。结束本 Host 的命令写在 pid 后的括号里 —— 它是关于这个 pid 的事实，而括号里写成「做什么：要输入的命令」：Windows 上是 `End task: taskkill /PID <pid> /F`，其他平台是 `End task: kill <pid>`，这样即使不认识这个工具，也知道括号里那半句是干什么的，同时它确实是 shell 会接受的命令。这是 Vite、Poetry、uvicorn 这类命令行工具的共同排版：不用 ASCII 艺术字、不用框线、组与组之间只留一个空行。身份那一行按 Host 的实际运行方式解析：打包版读自己 resources 旁的产物清单，读不到时退回到 Node 启动脚本上层的 `@deepseek-ai/dsh` CLI 包 —— 与源码启动（`dsh web`）走的是同一条上溯 —— 因此两边都打印 `DeepSeek Harness <版本>`，而不会退化成光秃秃的 `DSH`。那一行在两种部署下相同，因为命令本身就相同：命令行启动的 Host 就是你启动的那个进程，桌面版的 Host 是应用的子进程，两种情况下按 pid 结束它就是结束 Host。桌面应用会在子进程退出后另起一个 Host，所以这里写的是「Host pid」，而不是「退出应用」。

这个 shell 不是 Host 的子进程，因此在其中按 Ctrl+C 不会到达 Host。窗口打开之前，打包安装会写一个私有的 shim 目录，并把启动器放进 `PATH`：Windows 上的 `cmd` 与 PowerShell 用 `dsh.cmd`，其他平台用 `dsh` 脚本。`PATH` 上只放这一个启动器，终端需要的其他文件都留在它上面的私有根目录里。shim 把命令转发给安装目录自己的桌面 CLI（应用本身使用的那个），在缺少 `--profile` 时为 `plugin` 命令补上，并从 shell 环境中移除 Electron 交接变量。因此在这里执行 `dsh plugin add <third-party-plugin>` 与在应用自带终端中一样，会装进本 profile。源码启动没有可转发的桌面 CLI，因此不会写 shim，横幅里的命令照原样打印。欢迎脚本写在该私有根目录里（固定文件名，每次打开覆盖），不在系统临时目录里为每次打开留一份文件；旧版本残留的 `dsh-hello-world-terminal-*.ps1`／`.command`／`.sh` 会在打开时顺手清掉。窗口关闭后仍会留下的有两样：诊断日志 `%TEMP%\dsh-hello-world.log`，超过 512 KiB 时轮转为 `.1`（只保留一代）；以及 shim 目录本身 —— 每个 profile 与安装组合一份，以 profile 名加一段短摘要命名，每次打开重写。

仍有一条命令无法作用于 `desktop` profile：启动器把它保留给应用，因此 `dsh --dump-config` 会报告这一点，而不是输出配置；该行是为了与官方终端保持一致才列出的。

**组件可以单独开关。** 插件管理页的「包含的组件」显示 `quick-restart` 与 `quick-terminal` 两行，各带开关。关掉的组件根本不会被加载：它的 Host 侧路由消失，它的客户端 bundle 也随行卸载 —— 终端组件关闭时设置页不显示「打开 DSH 终端」，重启组件关闭时设置页头部不显示重启按钮。重新打开后两者自动恢复，都不需要刷新页面。

**两个开关，两种含义。** 组件开关是生命周期开关：它卸载路由与 bundle。配置里的 `enabled` 是策略开关：能力保持挂载并带原因拒绝，于是按钮能说明原因而不是直接消失 —— 查不到的能力没法解释自己。

-----

<a id="options"></a>
## 配置

在 profile patch 的 `quick-restart` 的 `config` 块中设置以下键。组件本身不带表单；插件管理页按这份 schema 生成表单，这也是每个键都是活配置（改完即时生效、无需重启）的原因。终端组件没有配置项。

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 策略开关；关闭后带 `disabled` 原因拒绝，按钮说明原因（卸载组件用组件开关） |
| `confirmBeforeRestart` | `true` | 重启前确认 |
| `refuseWhileBusy` | `false` | 有智能体或任务运行时拒绝重启 |
| `allowSupervisor` | `false` | 允许在进程管理器下重启 |
| `delayMs` | `250` | 应答与退出之间的延迟 |
| `waitTimeoutMs` | `30000` | 监控进程等待旧进程和端口的时长 |
| `settleTimeoutMs` | `30000` | 替代进程启动的等待时长 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 —— 点击展开</summary>

本包本身是一个 bundle：它不带运行时入口，只有一个 `cordis.patch.yml`，插入两行组件。两个组件各自是一个完整包，位于 `packages/dsh-quick-restart` 与 `packages/dsh-quick-terminal`，并在本包 `dependencies` 里以 `file:` 目录声明，由 `npm run build` 链入 `node_modules`。这两半缺一不可：Node 通过链接找到代码，而 profile 层的依赖闭包只有在该声明存在时才认得这个包 —— 行里的说明符是裸包名，只会拿 profile 的解析表解析，绝不会回到本包目录去找。它们不是 profile 级依赖，因此不会各自变成插件管理页里的一张卡片。组件标题与说明来自各自的 `locale/*.json` 的 `meta` 段，这就是同一张卡片下面能有两个不同标题的原因。

`quick-restart` 行负责 Host 侧的能力探测与重启。Host 侧判断能否重启，并启动一个分离的 `node -e` 监控进程。监控进程等待旧进程退出和端口释放，然后启动替代进程：重新执行 Host 的命令行；在桌面应用中则重新启动 `DeepSeek Harness.exe --updated`。命令行要求 `--port 0` 时，重新执行会沿用本 Host 实际绑定的端口；Web 启动会补上 `--no-open`。

客户端由两个 bundle 组成，各自随自己的组件加载与卸载。两者都在同一个 `settings.action` 座位注册一个条目：终端的 `open-terminal` 用 order 100，重启的 `restart` 用 order 110，因此它们共享「关闭」之前的同一行头部，重启排在右侧。注册、共享样式表与文案字典都放在 `ctx.effect` 中，卸载组件时随之移除。只有一份样式表 —— 两个组件都会渲染的基础原语，在 document 上做引用计数，因此先卸载的 bundle 不会摘掉另一个仍在使用的样式表。每个控件都是本插件自己的标记，颜色取自 `--dsw-alias-*` 主题 token；图标是外壳图标作品的本地副本，因为插件不应在运行时加载 UI primitives 包。

四条路由承载浏览器侧，全部在 `/api/dsh-hello-world/` 下：`status`、`restart`、`terminal/open`、`terminal/status`。每条都以 HTTP 200 返回并带 `ok` 标志，使拒绝保持可读；执行类路由在执行前会重新校验请求来源。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- `@deepseek-ai/dsh-plugin-manager` —— 激活本层的 `dsh plugin` 安装与 reconcile 路径，以及「包含的组件」列表的构建方式。
- `@deepseek-ai/dsh-client-modules` —— 组件包的 `dsh.client` 条目如何变成浏览器模块。
- `@deepseek-ai/dsh-client-ui-settings-general` —— 设置面板的所有者，它的头部渲染两个组件注册的 `settings.action` 座位。

-----

<a id="model-experience"></a>
## 模型体验

无，因为重启按钮、终端按钮和 `/restart` 都在 UI 命令面执行；它们中断的会话拥有全部模型可见效果。

### KV 缓存影响

不产生请求内容。重启会结束持有已缓存前缀的 Host，因此下一个会话会重建一次前缀。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- 重启会中断 Host 中所有运行中的智能体、队列中的回合和后台任务。
- 默认情况下，进程由进程管理器管理或已附加调试器时，插件拒绝重启：这两种部署中进程不掌握自己的生命周期。
- 重启按钮与终端按钮是头部动作，不是独立面板：头部布局归外壳所有，插件在 `settings.action` 里只能控制自己的 `order`；不渲染设置页头部的外壳两个按钮都不显示，`/restart` 命令仍可重启。
- 按钮依赖外壳自带的设置页头部；不渲染该头部的外壳两个按钮都不显示，`/restart` 命令仍可重启。插件仍按支持上报能力，而不是加载失败。
- 组件包内嵌在本包的 `node_modules` 中，并在 `dependencies` 里以 `file:` 目录声明。移动或重命名组件目录时，既要更新该 `file:` 路径（并重装），也要重新 `npm run build` 让链接指向新位置；缺少声明时包仍能构建，但该行在 profile 里会导入失败。
- 从终端重启时，替代进程与终端分离：终端回到提示符，新 Host 不是终端的子进程。诊断日志记录了替代进程的 pid。
- Windows 上替代进程不能继承 `windowsHide`，否则只会以托盘模式启动，没有可见窗口；监控进程会清除该标记。
- Linux 上打开终端需要 `PATH` 中存在 `x-terminal-emulator`、`gnome-terminal`、`konsole`、`xfce4-terminal`、`xterm` 之一。失败对话框会列出该列表；要加入其他终端，需扩展 `LINUX_TERMINALS` 并重新构建。
- 确认弹窗就地渲染，靠 `position: fixed` 逃出页面的裁剪。若外壳给祖先元素加上 `transform` 或 `filter`，弹窗会被困在祖先里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文 —— 点击展开</summary>

```bash
npm install
npm run build
npm run verify
```

`build.mjs` 生成五份产物：`packages/dsh-quick-restart/lib/{index,client}.js`、`packages/dsh-quick-terminal/lib/{index,client}.js`，以及 bundle 自己的 `lib/index.js`；每份都带 source map，随后刷新 `node_modules/dsh-quick-*` 两个链接。客户端产物只把 `react`、`react-dom` 与 `react/jsx-runtime` 保持为外部依赖 —— 外壳的模块表提供它们；其余控件都是本地的。

`npm run verify` 先跑 `npm run check`（类型检查，然后 esbuild），再跑四个脚本。先构建再验证不是多余的：客户端脚本像页面那样加载构建出来的 `lib/client.js`，产物陈旧时被验证的就是陈旧产物，而不是生成它的源码。`verify:bundle` 守住加载器依赖的那套接线：每一行插入的说明符都是裸包名、该行在 `dependencies` 里以 `file:` 目录声明、Node 能从本包清单经由 `node_modules` 链接走到那个目录、组件确实带 `./client` 半边，以及版本号在四份清单里一致。另外三个脚本分别覆盖 Host 半边、重启计划与客户端半边。

```
package.json           bundle 清单：dsh.bundle.patch，没有运行时入口
cordis.patch.yml       插入 quick-restart / quick-terminal 两行
build.mjs              esbuild：两个组件包的 Host 半边与客户端半边
tsconfig.json          只做类型检查；产物由 esbuild 生成
.editorconfig          两空格、LF、UTF-8
locale/                插件卡片自己的标题与说明
assets/icon.svg        插件图标
scripts/
  fixtures.mjs         一份共享的配置默认值
  verify-bundle.mjs    清单、patch 与版本号接线
  verify-host.mjs      Host 半边：路由、拒绝、日志轮转
  verify-plan.mjs      三个平台的重启计划
  verify-client.mjs    两个客户端半边，跑在桩 DOM 上
packages/
  dsh-quick-restart/   组件包：清单、locale、图标、构建产物
  dsh-quick-terminal/  组件包：清单、locale、图标、构建产物
src/
  bundle.ts            bundle 的极小入口（让包可以像其他插件一样被解析）
  index.ts             quick-restart 的 Host 入口：路由和 /restart
  config.ts            schemastery 配置
  diag.ts              诊断日志，512 KiB 轮转
  restart/
    index.ts           能力探测、重启计划、调度重启
    policy.ts          有序的拒绝规则，每条自带措辞
    guards.ts          进程管理器、调试器与请求来源检测
    activity.ts        统计重启会打断多少工作
    launch.ts          如何重启：桌面应用，或当前命令行
    helper.ts          分离的监控进程，由 `node -e` 程序生成
    routes.ts          /status 与 /restart
    command.ts         /restart 命令
    types.ts           Host 半边自用的视图类型
  terminal/
    index.ts           openTerminal —— 这半边唯一有副作用的地方
    identity.ts        产品名与版本解析、桌面部署查找
    shim.ts            私有的 `dsh` 启动器与 shell 环境
    plan.ts            三个平台的计划、欢迎脚本、PATH 查找
    banner.ts          横幅文本与排版
    entry.ts           quick-terminal 的 Host 入口：路由
    routes.ts          /terminal/open 与 /terminal/status
    client.tsx         设置页头部的动作
  client/
    index.ts           quick-restart 客户端入口：settings.action 座位、共享样式表、轮询
    store.ts           能力快照、轮询、重启后的恢复
    use-restart.tsx    动作 hook：确认、发起、等待新 Host
    entry-view.ts      按钮用的 label/reason/disabled 推导
    restart-action.tsx 头部按钮，渲染在 settings.action 里
    api.ts             四条路由
    service.ts         可选服务查找
    styles.ts          一份共享样式表，按 document 引用计数
    locales.ts         中英文字典
    types.ts           运行时服务的结构化视图
    ui/                本地化的原语：弹窗、提示、按钮、图标、焦点
  shared/
    protocol.ts        路由、线格式类型、守卫
    http.ts            通过 connection 服务挂载路由
    helper-plan.ts     监控进程计划的形状
    mount.ts           每个组件一条挂载/卸载日志
```

</details>
