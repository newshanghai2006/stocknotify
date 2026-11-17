# 股票 KDJ 监控提醒

这是一个轻量的股票行情与 KDJ 监控页面。程序使用 Python 标准库提供 HTTP 服务，浏览器定时请求公开行情接口，展示日线、15 分钟和 5 分钟 KDJ，并在满足条件时通过页面弹窗、提示音和浏览器系统通知提醒。

项目适合在个人电脑、云服务器或小型 Docker 主机上运行。它不包含交易下单功能，也不保存账户或服务端用户数据。

## 功能

- 默认监控股票 `688605`，可在页面中添加、删除多个股票代码。
- 支持按代码或名称搜索股票，并自动识别上海、深圳和北京市场代码。
- 展示腾讯实时行情：价格、涨跌、开盘、最高、最低和换手率。
- 获取日线、15 分钟、5 分钟 K 线并计算 K、D、J 曲线。
- 默认提醒条件：
  - 超买：`J > 98` 且 `K > D`
  - 超卖：`J < 2` 且 `K < D`
- 页面可修改超买、超卖的 J 阈值和刷新间隔（5～120 秒），也可暂停/开启提醒。
- 提醒包含页面居中弹窗、Web Audio 提示音和浏览器 `Notification` 系统通知。
- 同一股票、周期、K 线时间和提醒类型只提醒一次；最近 400 条去重记录保存在浏览器中。
- 提供“演示弹窗”按钮，便于先检查页面和声音效果。

## 目录结构

```text
stocknotify/
├── app.py                 # HTTP 服务、行情获取和 KDJ 计算
├── README.md
└── static/
    ├── index.html         # 页面结构
    ├── app.js             # 刷新、配置和提醒逻辑
    └── style.css          # 页面样式
```

## 环境要求

- Python 3.8 或更高版本（代码使用标准库，不需要安装第三方 Python 包）。
- 运行主机需要能够访问新浪和腾讯的公开行情接口。
- 浏览器建议使用近期版本的 Edge、Chrome、Firefox 或 Safari。

## 启动

在本目录执行：

```bash
python app.py
```

Linux/macOS 也可以使用：

```bash
python3 app.py
```

启动后默认监听 `127.0.0.1:8090`，本机打开：

```text
http://127.0.0.1:8090
```

程序使用 `ThreadingHTTPServer`，前端文件直接由 `static/` 目录提供。

### 修改监听地址和端口

编辑 `app.py` 顶部的配置：

```python
HOST = "127.0.0.1"
PORT = 8090
```

例如改成 8089：

```python
PORT = 8089
```

默认只监听 `127.0.0.1`，适合放在 Nginx/Caddy 等反向代理后面。如果确实需要让局域网直接访问，可将 `HOST` 改为服务器局域网地址或 `0.0.0.0`，同时配置防火墙；公网部署不建议直接暴露这个开发服务端口。

## 云服务器和 HTTPS 反向代理

云服务器上建议保持 Python 服务监听本机：

```text
浏览器 → HTTPS 域名 → Nginx/Caddy → http://127.0.0.1:8090
```

以 Nginx 为例：

```nginx
server {
    listen 443 ssl;
    server_name stock.example.com;

    # ssl_certificate 和 ssl_certificate_key 按实际证书填写
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

浏览器系统通知要求安全上下文：通常需要 HTTPS，或在本机使用 `localhost`/`127.0.0.1`。通过公网 IP 使用普通 HTTP 访问时，Edge/Chrome 可能拒绝通知权限。反向代理的外部地址应使用 HTTPS，页面打开后点击“开启提醒”，在浏览器权限提示中选择允许。

如果通过 SSH 隧道访问远程服务，可以在本机执行：

```bash
ssh -N -L 8090:127.0.0.1:8090 user@your-server
```

然后在本机打开 `http://127.0.0.1:8090`。SSH 会话断开后隧道也会结束；长期运行请使用下面的服务管理方式。

## 后台运行

### Linux systemd

创建 `/etc/systemd/system/stocknotify.service`：

```ini
[Unit]
Description=Stock KDJ Monitor
After=network-online.target

[Service]
WorkingDirectory=/opt/stocknotify
ExecStart=/usr/bin/python3 /opt/stocknotify/app.py
Restart=always
RestartSec=5
User=stocknotify

[Install]
WantedBy=multi-user.target
```

将路径和用户改成实际值后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stocknotify
sudo systemctl status stocknotify
```

查看日志：

```bash
journalctl -u stocknotify -f
```

临时后台运行也可以使用：

```bash
nohup python3 app.py > stocknotify.log 2>&1 &
```

### Windows

可在“任务计划程序”中创建登录时或开机时运行的任务，程序填写 Python 可执行文件，参数填写 `app.py`，起始位置填写项目目录。也可以先在 PowerShell 中运行：

```powershell
Start-Process python -ArgumentList "app.py" -WorkingDirectory "C:\path\to\stocknotify"
```

## 页面使用

1. 在顶部输入六位股票代码，或输入名称等待搜索建议，然后点击“加入监控”。
2. 在右侧修改超买 J 阈值、超卖 J 阈值和刷新间隔。设置会自动保存。
3. 点击“开启提醒”授权当前浏览器的通知权限。若此前选择过拒绝，需要到浏览器地址栏的站点权限中重新允许通知。
4. 点击“立即刷新”获取最新数据；满足条件时会出现弹窗并播放提示音。
5. 点击“演示弹窗”可在没有行情触发时测试页面弹窗和声音。

股票列表、提醒设置和已提醒记录使用浏览器 `localStorage` 保存，只对当前浏览器和当前域名生效。清理网站数据、切换浏览器或更换域名后需要重新设置。

## 提醒规则和计算方式

监控周期为日线、15 分钟和 5 分钟。KDJ 计算使用最近 9 根 K 线作为 RSV 窗口，K、D 初始值为 50，并使用 1/3 平滑，J 的计算式为：

```text
J = 3 × K - 2 × D
```

页面提醒使用当前页面中设置的 J 阈值，`K>D` 和 `K<D` 是固定条件。每个周期以最新一根 K 线的时间作为去重依据，因此同一根 K 线不会重复弹出同一类型提醒；进入下一根 K 线后，如果条件仍然满足，会再次提醒。

## 数据源、刷新和接口

- 日线优先使用腾讯财经接口，失败后回退到新浪接口。
- 15 分钟和 5 分钟 K 线使用新浪接口。
- 实时价格等报价使用腾讯行情接口；股票搜索使用新浪建议接口。
- 服务端行情缓存约 12 秒，前端默认每 15 秒刷新一次。
- 单次 `/api/monitor` 最多处理 12 个股票代码。

接口均为 GET：

| 地址 | 说明 | 示例 |
| --- | --- | --- |
| `/api/health` | 健康检查 | `/api/health` |
| `/api/search?q=` | 股票搜索 | `/api/search?q=688605` |
| `/api/monitor?codes=` | 获取监控数据 | `/api/monitor?codes=688605,600000` |

`/api/monitor` 未传 `codes` 时默认返回 `688605`。代码可填写六位数字，也可填写带市场前缀的形式，例如 `sh688605`、`sz000001`、`bj430047`；程序也会根据首位数字自动判断市场。

## 浏览器通知排查

- 必须在当前浏览器页面点击“开启提醒”，并在权限提示中选择允许。
- 远程访问请使用 HTTPS 域名；普通公网 HTTP 页面通常无法调用系统通知。
- 浏览器通知权限与域名、端口、浏览器实例绑定，换电脑或换浏览器后要重新授权。
- 系统通知被操作系统或浏览器的“勿扰模式”屏蔽时，页面弹窗和提示音仍可能正常工作。
- 第一次点击页面会尝试解锁音频，若无声音请检查系统音量、浏览器标签页静音和站点声音权限。

## 常见问题

### 端口被占用

查看占用端口的进程后，修改 `app.py` 中的 `PORT`，再重启服务。例如改为 `8089` 后访问 `http://127.0.0.1:8089`，反向代理的 `proxy_pass` 也要同步修改。

### 行情显示为空或接口报错

确认服务器可以访问新浪和腾讯接口，检查 DNS、出口网络、防火墙和接口限流。公开行情接口可能临时不可用或调整格式，程序会在对应周期显示错误，不会自动下单。

### 页面能打开但没有系统通知

确认当前地址是 HTTPS（或本机 localhost），并在站点权限中允许通知。仅打开页面不会绕过浏览器权限；如果之前拒绝过，需要手动清除该站点的通知阻止设置后再点击“开启提醒”。

## 限制与安全建议

- 这是个人监控工具，不是交易系统；行情可能延迟，K 线未必代表交易所最终数据。
- 新浪、腾讯接口属于公开网络接口，可能限流、改版或暂时不可用。
- 程序没有数据库、登录系统、Bark 推送或服务端配置持久化；配置只保存在浏览器本地。
- 建议只监听 `127.0.0.1`，通过 HTTPS 反向代理对外提供服务，并为域名配置访问控制。
- 不要把带有未授权访问控制的服务直接暴露到公网，也不要把该工具当作自动交易依据。

