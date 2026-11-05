# Yunzai

基于 [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)

Yunzai 应用端，支持多账号，支持协议端：OneBotv11、ComWeChat、ICQQ、QQBot、QQ频道、微信、KOOK、Telegram、Discord、OPQBot、Lagrange

项目仅供学习交流使用，严禁用于任何商业用途和非法行为

## 使用方法

> 必要环境 Windows/Linux + Chrome/Chromium/Edge

> 必要环境 Node.js>23.11 + Redis>6.0.0

### 克隆项目

```sh
git clone --depth=1 https://github.com/Xinglingsuiyue/Yunzai.git
cd Yunzai
```

### 安装 [pnpm](https://pnpm.io/zh/installation)

> 已安装的可以跳过

```sh
npm install pnpm -g
```

### 安装依赖

```sh
pnpm install -P
```

### 运行

> 首次运行按提示登录

```sh
node .
```

### 托管

```sh
pnpm start
```

| 操作 | 命令 |
| ---- | ---- |
| 启动 | pnpm start |
| 停止 | pnpm stop |
| 日志 | pnpm log |

## 设置主人

启动后发送 `#设置主人`，日志获取验证码并发送

## 开发文档

- [类型库](https://github.com/KaguyaJs/TRSS-Yunzai-Types)
- [oicq](https://oicqjs.github.io/oicq)

## 致谢

| Nickname | Contribution |
| -------- | ------------ |
| [Yunzai-Bot](https://gitee.com/le-niao/Yunzai-Bot) | 乐神的 Yunzai-Bot |
| [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) | 喵喵的 Miao-Yunzai |
| [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai) | 时雨的 TRSS-Yunzai |
| [yenai-plugin](https://gitee.com/yeyang52/yenai-plugin) | 椰羊的 yenai-plugin |
| [zhishui-plugin](https://gitee.com/fjcq/zhishui-plugin) | 止水的 zhishui-plugin |
| [chatai-plugin](https://github.com/XxxXTeam/chatai-plugin) | XxxXTeam 的 chatai-plugin |
| [guoba-plugin](https://gitee.com/guoba-yunzai/guoba-plugin) | 锅巴的 guoba-plugin |
