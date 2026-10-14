# 柏宝绘 · 流式重构版 0.4.0

基于原版最新 0.3.2（1187528），保留漫画页与 NAI Medium，重写流式任务管理。

酒馆安装链接：https://github.com/stilljy-commits/ST-BaiBai-Image

- 正文流式时分析 tag 并提前出图。
- 正文结束立即显示已有图片与在途位置，后到图片原位完成。
- 文末只补不足或长空档，和流式任务共用总上限。
- 关闭流式走原版流程；关闭自动出图只写 tag。

已从本仓库安装的用户更新后刷新。原作者仓库的安装需要切换到本仓库，避免同时启用两个版本。开启插件总开关、自动分析 tag、流式出图；需要自动生成时再开启对应开关。

[完整设置及复测说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.0.md)。

本次通过 65 个测试文件、830 项测试；3 项原有跳过。完整类型检查、生产构建通过。离线检查没有消耗真实 NAI 点数，真实服务出图与客户端渲染需更新后复测。

main 是酒馆发布文件；完整源码在 codex/stream-rebuild。源码提交：[be6492f28e2e164b31c50c91c0583d76b25e70d1](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/be6492f28e2e164b31c50c91c0583d76b25e70d1)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
