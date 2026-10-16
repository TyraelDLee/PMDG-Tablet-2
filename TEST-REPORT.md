# EFB v2 安装器与 LAN 验证记录

## 0.2.15 · Auto Cruise 弹窗与按钮文字

原生 Popup 使用百分比绝对定位；LAN 为顶栏增加的定位上下文将弹窗限制到顶栏高度，浏览器支持的 backdrop-filter 又会形成 fixed 定位包含块。LAN 端移除不影响实色顶栏外观的 backdrop-filter 和局部堆叠限制，仅将 Auto Cruise 遮罩改为 fixed，并由既有 fit/contentRect 写入可见 EFB 区域的坐标和尺寸。保留原生 popup-content 灰色背景、比例、居中规则及显示/隐藏状态。遮罩独立于 2048 方形纹理的无用部分。未修改模拟器 DOM 或 PMDG 脚本。

AUTO CRUISE、性能计算 opt_clear/opt_calculate 显式使用黑色字体；原生 disabled 灰色规则继续优先。八机型共用 LAN 样式，无需分别改动机型源码。

完整浏览器桥接回归通过，无 JS 错误。新增检查提取并渲染实际 PMDG Popup/AutoCruisePopup，验证横屏、竖屏、桌面三个尺寸下遮罩覆盖实际 EFB、窗口居中、灰色背景与 0.7 黑色遮罩、前景命中测试；触摸打开、Reset 指令回传及关闭均通过。三个目标按钮为黑字，禁用 Calculate 保持灰色。截图 tests/results/autocruise-popup.png 已检查。尚未替代真实 iPad/MSFS 验证。

## 0.2.14 · LAN 顶栏字体和垂直对齐

机型和 CA/FO 继承原生时间栏的 Inter 字体、19px 字号及常规字重，当前选中侧保持加粗。控件高度对应原生文本行盒，排除父级 padding 对垂直对齐的影响，按钮仍保留 36px 点击高度；整组在原空位内靠右排列。仅修改 LAN CSS。

使用八机型发行包的原生 PMDGTablet.css、字体资源和 StatusBar 结构进行浏览器排版检查：时间、机型、CA、FO 的文字中心均为同一坐标，字体和字号一致，未发生横向溢出或覆盖 Home 栏。预览截图已检查。用户已确认前版 Door Management 和桥接器随模拟器关闭正常；本次不改相关逻辑。
## 0.2.13 · LAN 顶栏滑块、机型标识及明确换行

顶栏显示机型、CA/FO 整块 switch 按钮及 SVG 重同步图标。新开页面始终默认 CA；点击两侧文字或滑块均切换，aria-checked 同步驱动加粗与滑块左右位置。控件保持同一 DOM 节点并在离线时移到等待页面；共享 lan-controls.css 保证两处外观一致。未新增外部 banner。

宿主优先读取现有 PMDG getAircraftType()，再回退 TITLE 和页面路径；将 737 的 PAX/BBJ/SSW/BW 等细分简化为基本型号，保留 737-900ER 和 777 ER/LR/F。机型进入帧元数据及变化检测，页面其他部分不变时也可更新。原生 PMDG 函数不修改。

Door Management 的 LAN 文本快照明确包含换行符，专用 pre-line 样式显示两行；原生 DOM 保持原文本。这次不再依靠字符串是否恰好超过按钮可用宽度。

浏览器集成回归验证：九种型号输入归一化；旧 FO 偏好不覆盖 CA 默认；两侧字体权重和滑块位置；轨道和文字触摸切换到离线 FO 再切回 CA；重同步控件不重复且位于时间与 Home 之间，无横向溢出。原有输入、触摸、地图、航图、服务代理与配对检查通过。预览 tests/results/lan-statusbar.png。实际 MSFS/iPad 上的新布局仍需用户确认。

## 0.2.12 · 八机型基线、模拟器 Zulu 记录与自动退出

Build.ps1 默认来源改为用户扩充的 dist/EfbV2-LAN-0.2.11/package/pmdg-tablet-v2，包含八个独立机型及 16 个 CA/FO 入口。只从源包复制，不回写它；公共落地分析源文件集中于 landing-analysis 并在构建时应用到八机型。

落地采样在地面接触样本读取 E:ZULU YEAR/MONTH OF YEAR/DAY OF MONTH/TIME，以首次接地样本保存 zuluTimestamp；原 timestamp 仍用于去重和排序。新记录显示模拟器 UTC 并标注 Z，旧记录不新增时间字段、不转换。无法读取合法 Zulu 时间时显示 -- Z，不伪造现实时间。删除右上状态元素及底部说明整行。

旧服务只有 --sim-start 启动才监测退出；安装器提前启动的实例持有互斥锁后，可使自动启动实例无法接管。现有实例无论启动方式均观察模拟器进程，确认曾运行且连续消失六秒才退出，每两秒检测；未知探测结果不会误判。手动提前启动可无限等待，自动启动但一直没观察到模拟器则保留原十五分钟超时。应用停止时中止宿主/客户端 WebSocket、取消 GSX/BATC 代理并限制关闭等待时间。

新增测试通过：真实落地 host/core 流程保存第一次接地的模拟器日期、时钟调整后不覆盖；无效时间不破坏记录；旧历史原样读回；悉尼与洛杉矶浏览器时区下当前/历史详情显示相同 Zulu 时间。退出策略测试覆盖手动/自动启动、等待、持续运行、短暂探测空缺、探测失败及确认退出。截图 tests/results/landing-zulu.png。策略测试未替代真实 MSFS 退出实测。

## 0.2.11 · LAN 触屏交互与地面操作文字

检查实际 PMDG 的 initSelectLogic/applyCustomSelectSelection：选项点击更新值并停止冒泡，收起操作只在自定义选择框的 mouseleave 监听器中执行。桥接宿主现只在远程点击完成后为选中列表/其他打开列表触发该原生收起事件；模拟器本地鼠标点击逻辑未修改。

LAN 按钮/自定义选择框短按在 touchend 后发送一个受时间戳、会话和类型限制的 tap 消息，宿主在同一处理流程分发一次 down/up/click。触摸移动、长按、多指、取消、禁用状态和离开控件时不激活；滑动不被 touchstart 阻止；过滤已处理触摸的兼容鼠标事件，不影响真实鼠标及原有地图拖拽。此适配不进入 GSX/BATC 自己的子页面。地面操作导航文字区域限制为按钮剩余宽度，允许正常换行。

浏览器集成测试使用发行包中真实的 PMDG 选择框函数和地面导航 CSS：触摸/鼠标选择后原生数据同步且列表隐藏，本地原生点击行为保持原状；点击其他控件收起列表；触摸滚动选项不误选。单次门控短按收到且仅收到 down/up/click，注入重复鼠标事件不重复，紧接真实鼠标仍可工作；拖动、长按、取消、多指和禁用按钮无点击。Door Management 实际文字行盒为两行且无横向溢出。完整 LAN 回归通过，无 JS 错误。尚需真实 iPad/MSFS 确认间歇性双击问题是否完全消除。

## 0.2.10 · iOS 主屏幕顶部显示适配

LAN 入口明确设置 apple-mobile-web-app-capable=yes、status-bar-style=default 和固定主题色。主屏幕模式通过 display-mode 或 navigator.standalone 检测；顶层文档增加真实 fixed 实色背景，安全区来自 env(safe-area-inset-*)，无安全区时仅保留 1px，不恢复 banner。普通浏览器不启用这套布局。模拟器 EFB 和桥接宿主脚本不改动。

浏览器回归通过：模拟 standalone 状态的检测、真实固定元素尺寸/颜色、不拦截触摸；注入不同安全区值验证横竖屏视口与 EFB 缩放；重新同步保持背景，退出 standalone 恢复普通浏览器全高。原有输入、CA/FO、地图拖拽、航图和 GSX/BATC 等回归通过，无 JavaScript 错误。浏览器测试不能模拟 iOS 系统合成器，消除模糊的效果尚未在真实 iPad 验证。

参考用户提供的实际测试讨论（不同系统版本反馈不一致）：https://www.reddit.com/r/PWA/comments/1w5mqj1/ios_27_beta_blurs_the_top_edge_of_installed_pwas/
Apple 状态栏配置文档（归档）：https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html
WebKit 安全区说明：https://webkit.org/blog/7929/designing-websites-for-iphone-x/
更新后应移除旧主屏幕快捷方式并从 Safari 重新添加，以重新读取安装时的状态栏配置。

## 0.2.9 · LAN 原生顶栏控件与搜索加载动画

移除外层 banner，浏览器视口使用完整高度。CA/FO 与 Re-sync 作为浏览器独有节点放入原生状态栏时间右侧空列；等待连接时移回等待界面，离线 FO 仍可切回 CA。DOM 同步保留这些节点，避免反复更新中断选择框焦点。航图机场搜索按钮的 spinner 伪元素添加持续旋转，搜索完成恢复放大镜后不再旋转。

浏览器集成回归通过：状态栏空间与全高视口、补丁和完整重同步期间控件不被移除且无重复、选择框焦点保留、CA/FO 离线切回、搜索图标旋转与完成恢复。原有输入、地图鼠标和触摸拖拽、航图转交、GSX/BATC 代理、断线恢复和配对检查通过，无浏览器 JavaScript 错误。模拟器宿主 DOM 不包含新增控件，原生 EFB 及宿主脚本不修改。尚未进行 MSFS/iPad 实机确认。

## 0.2.8 · LAN Navigraph 地图提示

工作目录迁移至 B:\Developing\pmdg-tablet\efb-lan。客户端按原生地图源选择器的 visible 状态设置 LAN 文档根标记；client-fixes.css 仅在对应地图的 Leaflet 根容器上显示 NAVI MAP INOP。提示不位于旋转/平移图层内，不接收鼠标或触摸事件，切回 PMDG 模式后消失。原生 EFB 脚本未更改。

使用实际 client.js/client-fixes.css 的浏览器预览确认 Navigraph 模式提示文字及 pointer-events:none，PMDG 模式伪元素为 none；现有浏览器集成回归通过。预览图保存于 tests/results/navi-map-inop.png。未直接修改 Community。


## 0.2.7 · 移除 LAN Navigraph app、修复图标与加载动画

按用户要求移除独立 app 的前端、Dock 注入和配置 API；原有模拟器航图转交仍保留。安装和重复打包清理旧 app JS/CSS；已有本地 navigraph.json 保留但不再读取。原有 0.2.6 段落仅为历史记录。

PMDG 的地图切换按钮实际生成 coui://html_UI//Pages/.../hurricane_white.png，双斜杠使旧桥接的本地路径被视为根路径。宿主现在规范化 coui 根路径，服务同时兼容旧宿主传来的 /assets//Pages/...；原有软件包边界和桥接配置文件保护仍生效。

LAN 专用 client-fixes.css 保留箭头和触摸样式，并给 #efb_navigraph_chart_loading::before 添加 1 秒线性无限旋转；禁止外部定位容器跟着转动。未覆盖 display 属性，原生加载完成后依旧隐藏。

浏览器集成回归通过：旧 app 路由返回 404、页面同步不会重新插入入口；真实 hurricane_white.png 可解码，四个机型的旧双斜杠路径均返回 PNG；两次采样确认加载图标角度变化，宿主隐藏后客户端也隐藏。缩放、输入、地图拖拽、航图图片、GSX/BATC 代理与鉴权回归通过。此处使用浏览器模拟宿主，未代替 MSFS/iPad 实机验证。

## 0.2.6 · Navigraph 独立配置 app

用户尚未申请开发者应用，明确选择先完成 UI 与配置入口。本版提供 LAN EFB Dock 入口与独立配置页；没有调用实际 Navigraph 授权接口、没有使用 PMDG 客户端凭据，也没有启用新的图片传输方式。登录按钮明确标为待接入，不显示虚假的登录状态。

浏览器集成测试通过：入口打开/返回且不触发模拟器操作；重同步只保留一个入口且不覆盖正在输入的配置；Client ID 保存、重读、非法值拒绝；保留本地密钥及未来字段；响应不含密钥；配置文件不能通过静态 URL 下载；配置 API 配对与 Origin 检查。横屏双栏、竖屏单栏已查看截图，配置内容可独立滚动；原有缩放、拖拽、资源、代理与断线重连回归继续通过。

配置位于 bridge.json 同目录的 navigraph.json，只在保存时创建，不加入发行服务文件清单，避免升级覆盖。真实 Navigraph 登录及 Safari 直连将在取得项目自己的应用配置后再实现和验证。

## 0.2.5 · 有效区域适配、触摸及资源诊断

现场只读快照确认：模拟器页面为 2048×2048，而当前 777F 的 pmdg-tablet 元素实际为 2048×1562。旧版按完整纹理缩放造成下方及两侧额外留白。宿主现在发送实际元素边界（包含偏移），网页保持原生 iframe 的布局坐标，在外层裁掉纹理空白后等比例适配、水平垂直居中。旧宿主未提供边界时，从重建的平板元素测量。支持 ResizeObserver、窗口/可视视口变化；不拉伸内容，比例不同仍有必要留白。

浏览器集成验证覆盖桌面 1920×1080、平板横屏 1194×834、竖屏 834×1194；2048 方形纹理内的内容尺寸及非零偏移；缩放后点击的原生坐标；地图鼠标拖拽、浏览器真实触摸事件、取消释放及拖拽后控制按钮点击一次。使用与 bundled Leaflet 相同的 which/button 准入条件验证主键兼容。下拉箭头用 CSS 边框绘制，不依赖缺失的字体字形。

图片验证增加 application/octet-stream 的 PNG 字节识别和 HTTP 403 诊断；诊断接口要求配对。已有分块图片传输、重连、操作事件、CA/FO 隔离、服务代理及鉴权回归通过。Navigraph 网络测试仍使用模拟授权瓦片：不能据此确认真实 Coherent 的 Cookie/CORS 读取问题已解决；新版诊断用于定位实机失败步骤。未直接修改 Community。

## 0.2.4 · 原生图片资源与图标

从 PMDG 源码确认：航图通过 getChartImage 获取 Blob 后以 URL.createObjectURL 设置 IMG；地图使用 Navigraph 栅格 IMG 瓦片。官方瓦片说明确认授权通过 signed cookies。旧桥接直接复制 Blob/远端 URL，无法在另一个浏览器共享这两类资源。

新实现由模拟器使用自身会话读取图片，以 128 KiB Base64 块传给本机服务，再由已配对浏览器读取同源图片端点。原图字节保持不变，不捕获屏幕、不输出视频；不将 Navigraph Cookie/Token 发送给桥接器或 iPad。资源按宿主、侧别、epoch 隔离，仅内存缓存；大小和并发有界，宿主断开即释放，重连重传仍在使用的资源。

图标修复包括原始 LINK 样式表同步、coui/根路径与相对样式资源改写，以及 SVG URL 的片段保留。即使原生 CSSOM 无法枚举外部样式，浏览器仍可加载包内 Font Awesome 及首页背景图片。

自动验证通过：随机大 PNG 多块传输并逐字节比较；模拟受 Cookie 保护的 Navigraph 瓦片只有原生浏览器发起请求，远端无需登录；配对和 CA/FO 隔离、宿主断开资源失效、重连重传且不重新下载瓦片。屏蔽原生 cssRules 的情况下，Font Awesome 字体和图标样式可加载，coui 图片能解码，SVG fragment 保留。现有操作、代理、配对限流等集成测试全部继续通过。完整安装包隔离安装、真实服务启动及卸载验证通过，编译无错误、无警告。

本机运行中的旧服务在检查时没有在线宿主，因此未取得实机页面快照。上述 Navigraph 网络验证使用模拟瓦片响应，没有测试用户账号或真实授权服务；实际 Coherent 跨源读图、iPad Safari 图标与航图表现需用户安装新版后验证。Community 未直接修改。

## 0.2.3 · 简短配对码与 G 值突出显示

安装器生成 4 位纯数字字符串，升级旧长码一次性换码，保留模拟器 HostKey、端口以及已有合规短码。回归测试覆盖前导零 `0042`、旧码迁移及重复安装。桥接登录 cookie 改为基于 HostKey 和 PIN 的 HMAC 长令牌；PIN 本身作为伪造 cookie 无法访问会话或 WebSocket。配对接口限每分钟 5 次请求，测试确认超限返回 429，已有会话仍有效。浏览器/真实服务集成测试继续通过。

落地分析仅交换展示顺序和强调样式：两组指标均先 G 值后接地率，蓝色半宽大字应用到 G 值；适用于 737-800、777-200ER、777-300ER、777F。未更改 core.js、host.js、计算逻辑或历史格式。打包脚本包含可重复应用的展示修改，重新打包不会丢失。浏览器预览位于 `tests/results/landing-g-primary.png`；模拟器内效果仍需更新后确认。

## 0.2.2 · 修复缺少模拟器端脚本入口

现场检查：服务配置与模拟器端配置的端口、密钥匹配，但已安装包及发行副本的 8 个 PMDGTabletCA/FO.html 均没有 LAN 导入。LAN 安装分支原先只写配置，打包的 ReusePackage 分支也跳过入口注入，导致服务启动不代表模拟器会连接。

修复后，安装器根据模式为每个页面重建或移除 config/host 导入；每个仅一次，配置在前。打包复用时同样刷新脚本、入口和 layout.json。编译无错误、无警告。

回归检查通过：缺少导入的 CA/FO 载荷升级 LAN、重复导入去重、反复安装及切回仅 EFB；完整载荷在隔离 Community 安装，全部 8 页导入正确，真实服务启动、模式切换和卸载通过。现有不访问 backups、保留配对码等检查继续通过。

浏览器集成测试改为从发行 HTML 读取入口，并加载发行包实际脚本与服务生成的配置；在独立副本运行，避免把测试密钥写入发行文件。连接、输入/计算事件、返回状态、断线恢复、CA/FO 隔离、服务代理和鉴权均通过。此测试使用浏览器模拟原生页面，不能替代 MSFS Coherent 实机验证。未修改实际 Community 文件；用户需安装新版后重启模拟器验证。

## 0.2.1 · 移除备份功能

已移除安装、更新、修改端口及卸载中的备份与回滚。卸载直接移除 v2 软件包，不恢复旧版本；旧安装记录中的备份字段被忽略，不访问或清理旧备份。

测试在安装目录预置名为 `backups` 的普通文件，以使任何创建或访问备份目录的尝试立即失败；安装、更新、端口调整、故障后重试及卸载仍通过，且该文件不变。新增故障测试确认不再声称已回滚，临时新载荷被清理，重试可完成。模拟厂商飞机目录保持不变。完整载荷安装、真实服务启动、模式切换及卸载也通过，未生成 backups 目录。

文件复制改为读写数据流，不沿用源文件的 EFS 加密属性。此验证未在本机主动创建 EFS 加密文件。以下旧版备份/恢复结果仅为历史记录，不代表 0.2.1 行为。

## 0.2.0 图形安装器 · 2026-10-12

安装逻辑改为 C#，WinForms 图形界面，以 asInvoker 普通用户权限运行，发行 EXE 包含 .NET 运行时。旧 PowerShell 安装逻辑不再参与发行包安装。

自动测试通过：零个/单个/多个安装位置、Steam/Store 路径、Community2024、中文路径、仅 EFB 无需 UserCfg 和 LAN 载荷、EFB 升级为 LAN、重复安装、保留配对码和原始备份、旧 PowerShell 安装记录迁移、端口占用不修改现有配置、替换软件包后的故障恢复、应用端口与清单更新、LAN 降级为仅 EFB、卸载恢复最初的 EFB。

完整发行载荷测试通过：隔离目录安装真实服务并检查 HTTP 健康接口；与 GUI 相同的后台线程生成快捷方式；管理器复制到模拟用户安装目录；切回仅 EFB 时停止真实进程并删除服务；卸载新安装的软件包。测试使用工作目录中的模拟 Community、配置目录和开始菜单，不修改当前模拟器安装。

已渲染并检查 GUI 布局，修正控件文字裁切。编译 0 错误、0 警告。机器实际 MSFS 自动启动、Coherent 和 iPad 交互仍需用户运行模拟器验证。

详细结果：`tests/results/gui-tests.json`、`tests/results/gui-package-test.json`；测试代码：`Setup/SelfTest.cs`。

## 0.1.0 LAN 桥接历史验证

日期：2026-09-21。测试使用隔离的工作目录、Windows x64 独立运行时和 Edge 无头浏览器；未启动 MSFS、未操控实际飞机、未修改现有 Community v2。

通过的浏览器/服务集成检查：

1. 未配对客户端和错误的模拟器密钥被拒绝。
2. 网页输入、下拉框及 Calculate 操作传给测试用原生处理函数，且只触发一次；结果返回网页。
3. 滚动状态回传。
4. Canvas 2D 绘图指令在浏览器重绘。
5. 完整重新同步不重建 BATC iframe，保留其连接。
6. 超时及旧会话操作被丢弃。
7. GSX、BATC 代理与模拟服务完成双向 WebSocket 通信。
8. 前端连接地址改写、模拟器密钥文件禁止访问、跨 Origin 拒绝。
9. CA / FO 状态隔离。
10. 已配对浏览器刷新后恢复原有状态。
11. 模拟器适配器断开后显示离线，新会话重建状态，不重放旧操作。
12. 无客户端订阅时不发送 DOM 更新。
13. 浏览器无 JavaScript 异常。

Windows PowerShell 5.1 安装测试通过：安装、再次安装、保留端口及密钥、布局清单大小校验、exe.xml 合并不重复、卸载后恢复原 v2。故意使用缺少桥接文件的损坏包，确认替换包之后的安装失败会恢复原包及 exe.xml。

独立程序编译：0 错误、0 警告。包含 .NET / ASP.NET Core 9.0.18 运行时，无需用户安装 .NET。

打包副本与 Community 原件比较：既有文件仅 `PMDGTabletCA/FO.html` 增加桥接脚本导入、`layout.json` 更新；PMDGTablet.js、GSX、BATC、Landing Analysis 等原文件逐文件 SHA-256 相同。新增文件位于共享 `lan-bridge` 目录。

以上不能替代真实模拟器验证：实际 PMDG CommBus 回应、自动启动时机、Coherent 兼容性、跨设备 LAN、防火墙、Safari 触摸，以及 Navigraph / PDF / WebGL 页面尚未验证。特殊图形支持边界详见 README。
