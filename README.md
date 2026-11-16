# \# 本机只要 Python 3.8+，不用装第三方库。把工作区里的 app.py 和 static/ 整份拷到你电脑同一目录。

# 

# 

# \# Windows / macOS / Linux 都一样，在该目录执行

# python3 app.py

# 浏览器打开 http://127.0.0.1:8090 。电脑要能上网（拉新浪/腾讯行情）。程序已监听 127.0.0.1:8090，局域网用 http://你的电脑IP:8090 即可。

# 

# 长期挂着：Linux 用 systemd/nohup python3 app.py，Windows 可把该命令放进任务计划程序。端口被占用时改 app.py 里的 PORT。

