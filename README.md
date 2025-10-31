# 📱 koishi-plugin-hoyolab-notifier

[![npm](https://img.shields.io/npm/v/koishi-plugin-hoyolab-notifier?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-hoyolab-notifier)
[![downloads](https://img.shields.io/npm/dm/koishi-plugin-hoyolab-notifier?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-hoyolab-notifier)
[![license](https://img.shields.io/github/license/pynickle/koishi-plugin-hoyolab-notifier?style=flat-square)](LICENSE)

## 🎮 插件简介

**koishi-plugin-hoyolab-notifier** 是一个为 Koishi 机器人框架设计的米游社文章监控与通知插件。它能够监控指定米游社用户的文章更新，并在有新文章发布时，通过群聊及时通知订阅者，支持自定义标题过滤和用户昵称显示。

## ✨ 功能特性

- 📢 **自动监控**：定时检查米游社用户发布的新文章
- 🔔 **群聊通知**：在订阅者所在的群聊中发送通知消息
- 👤 **用户昵称**：自动获取并显示米游社用户的昵称，而非仅显示UID
- 🔍 **标题过滤**：支持通过正则表达式过滤特定标题的文章
- 📋 **多群支持**：同一用户可以在不同群聊中独立订阅不同的米游社用户
- 📱 **内容解析**：支持解析文章中的图片和视频内容
- 🎬 **视频处理**：智能判断视频时长，长视频显示链接，短视频直接嵌入
- 🗄️ **数据持久化**：使用Koishi数据库系统存储订阅信息和已发送文章记录

## 📋 命令列表

| 命令                           | 说明                        | 权限要求 |
|------------------------------|---------------------------|------|
| `hoyolab.check`              | 手动触发检查米游社文章更新             | 管理员  |
| `hoyolab.list`               | 查看全局米游社监听配置               | 所有人  |
| `hoyolab.subscribe <uid> [regex]` | 订阅米游社用户的文章更新（可选正则表达式过滤）  | 所有人  |
| `hoyolab.subscriptions`      | 查看已订阅的米游社用户列表             | 所有人  |
| `hoyolab.unsubscribe <uid>`  | 取消订阅指定米游社用户               | 所有人  |

## 🚀 使用指南

### 1. 安装插件

```bash
npm install koishi-plugin-hoyolab-notifier
```

或在插件商城中搜索 `koishi-plugin-hoyolab-notifier` 进行安装。

### 2. 基本使用

1. **订阅米游社用户**：在群聊中发送命令 `hoyolab.subscribe <uid>`，例如 `hoyolab.subscribe 160946056`
2. **使用标题过滤**：发送命令 `hoyolab.subscribe <uid> <regex>`，例如 `hoyolab.subscribe 160946056 原神`
3. **查看订阅列表**：发送命令 `hoyolab.subscriptions` 查看当前群聊中的订阅
4. **取消订阅**：发送命令 `hoyolab.unsubscribe <uid>` 取消特定用户的订阅
5. **手动触发检查**：管理员发送命令 `hoyolab.check` 手动检查文章更新

## 📁 文件结构

```
src/
├── index.ts              # 插件主入口，命令注册和数据库定义
├── post-checker.ts       # 文章检查和消息发送逻辑
├── content-helper.ts     # 文章内容解析和处理
├── web-helper.ts         # 网络请求辅助函数，提供随机User-Agent
└── onebot-helper.ts      # OneBot适配器辅助函数
```

## 🔧 技术说明

- 插件使用axios发送HTTP请求获取米游社文章和用户信息
- 自动设置合适的请求头，包括User-Agent、Origin和Referer
- 文章内容解析支持文本、图片和视频等多种格式
- 视频内容根据时长进行智能处理，长视频(>1分钟)显示链接，短视频直接嵌入
- 数据库结构包含用户订阅表和已发送文章记录表
- 支持同时监控多个米游社用户，并向多个群聊发送通知

## 📝 注意事项

- 订阅命令必须在群聊中使用，以便在该群聊中接收通知
- 正则表达式必须是有效的，否则会提示语法错误
- 同一用户在同一群聊中对同一米游社用户只能有一个订阅
- 文章通知会@订阅者，确保订阅者能及时看到更新
- 系统会记录已发送的文章，避免重复通知
- 获取用户信息失败时会使用UID作为备用显示名称
- 支持在配置文件中设置全局监控用户，无需手动订阅

## 🤝 贡献指南

欢迎提交Issue或Pull Request来帮助改进这个插件！

## 📄 许可证

本项目采用MIT许可证 - 详情请查看 [LICENSE](LICENSE) 文件