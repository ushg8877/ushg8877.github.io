# ushg8877 的个人博客

网站：https://ushg8877.github.io

## 发布文章

在 GitHub 的 `_posts` 目录中新建 `YYYY-MM-DD-english-slug.md`，例如 `2026-10-14-first-note.md`：

```markdown
---
title: 文章标题
date: 2026-10-14
tags: [随笔]
---

在这里写正文，支持 Markdown。
```

提交到 main 后，GitHub Pages 会自动更新。首页、归档和标签会自动收录文章。未来日期的文章默认不会发布；日期使用北京时间。

图片放入 `assets/images/`，在正文用 `![说明](/assets/images/example.png)` 引用。

## 优先级与语言版本

首页、归档及相邻文章按 `priority` 从大到小排序，相同优先级按 `updated_at` 从新到旧排列。旧文章没有这些字段时，优先级为 `0`，更新时间使用 `date`。本地管理软件在实际修改并保存文章时自动更新 `updated_at`，阅读或切换编辑语言不会改变时间。

中文原文保存在普通 Markdown 正文中。通过本地管理软件的“新建语言”添加日语或英语版本，译文与原文一起保存、发布，不会变成重复文章。手动编辑时使用以下格式：

```yaml
priority: 10
updated_at: '2026-10-15T12:30:00+08:00'
translations:
  ja:
    title: 日本語のタイトル
    body: |
      日本語の本文。Markdown に対応しています。
  en:
    title: English title
    body: |
      English text with **Markdown**.
```

网页只显示有非空正文的语言选项；未写译文时使用中文原文。译文有正文但没有标题时使用中文标题。语言链接可使用 `?lang=ja` 或 `?lang=en`；请求不存在的版本时仍显示中文。文章优先级支持 `-9999` 到 `9999` 的整数。

网站标题在 `_config.yml` 修改，首页介绍在 `index.html` 修改。源码使用 GitHub Pages 自带的 Jekyll 构建，无需安装依赖即可在 GitHub 写文章。

## 评论、点赞与浏览量

文章底部通过 [giscus](https://giscus.app/zh-CN) 提供 GitHub 登录评论和点赞，数据保存在本仓库 Discussions 的 Announcements 分类。可在 GitHub 中管理、编辑或删除评论。首次留言或点赞时由 giscus 创建对应讨论；各语言版本、链接查询参数和页面锚点共用该文章的讨论。文章网址是关联标识，改动文章 slug 会创建新的评论入口，重命名前请保留旧网址或迁移讨论映射。

仓库需开启 Discussions，并将 [giscus GitHub App](https://github.com/apps/giscus) 安装到 `ushg8877.github.io`。配置位于 `_config.yml` 的 `giscus` 区块，设 `enabled: false` 可关闭嵌入。`giscus.json` 限定只允许正式博客域名使用评论。页面不包含 GitHub 私密令牌；读者自行授权登录，站主无需代读者操作。

[Vercount](https://www.vercount.one/) 记录实际页面浏览，文章顶部显示本文浏览量，页脚显示全站浏览量。统计从接入后开始，不推算过去的访问。每次实际加载页面计一次；切换语言、主题不重复计数。计数请求使用去掉查询参数和锚点的规范网址，不发送评论登录参数。本地预览不计数，服务不可用时显示 `—`；统计可能受到网络、拦截器和自动访问的影响。

浏览量脚本为 `assets/page-views.js`，使用官方公开 v2 接口，勿同时加载官方 `/js`，否则会重复计数。它会使用与官方客户端相同的第一方 UV 标记；这不是文章点赞记录。点赞和评论通过 GitHub 保存，在其他设备登录同一账号也可管理。
