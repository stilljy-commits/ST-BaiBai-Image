# 柏宝绘 · 流式重构版 0.4.2

安装/更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

本版修复后到 tags 与图片反复重画整条消息造成的闪烁；按实际图片比例预留高度，加载完成前保留占位。

流式分析有空闲槽时立即启动；积压队列中相邻两个标记可共享一次完整分析，漏标记或错配自动退回单张。明确当前目标段的建档范围，复用本楼已确认的首次建档，不把后文临时状态提前套入旧画面。保留全部规范、思维链、角色设定与模型原生思考设置。

正文结束立即显示已就绪图片和在途位置，各图继续独立生成、保存、进入原槽位。

[修改与复测说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.2.md)。

验证：69 个测试文件，868 项通过、3 项原有跳过；完整类型检查与生产构建通过。另完成独立浏览器布局检查。此次没有主动调用真实 tags API 或 NAI；真实耗时与画面效果需更新后复测。

main 是酒馆发布文件；完整源码在 codex/stream-rebuild。源码提交：[a1234ce7d1c143d4e4735c80f394f418a678186a](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/a1234ce7d1c143d4e4735c80f394f418a678186a)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
