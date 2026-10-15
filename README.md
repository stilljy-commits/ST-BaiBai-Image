# 柏宝绘 · 流式重构版 0.4.7

安装/更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

所有数量范围统一每3个正式标记合批分析，取消小数量例外。5个标记按3＋2，9个按3＋3＋3，10个按3＋3＋3＋1；不足3个的尾批等正文结束后立即发送。数量范围控制整楼预算，NAI仍逐张生图。

修复草稿中的标记被提前派发或配错正文的问题：扫描排除草稿、思考、注释及配置的隐藏区块，正文清洗保留正式叙事及物理行号映射。日志区分合批、单张和文末补充，并记录合批失败类别。

通用映画文法、完整分镜与质量检查、图片原位更新、浮层收尾和并发设置保留。失败隔离重试和文末补图仍可产生单张请求。

验证：70个测试文件，927项通过、3项原有跳过；类型检查与生产构建通过。真实API提速幅度尚未实测。

[完整版本说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.7.md)。main存放酒馆发布文件，完整源码在codex/stream-rebuild。源码提交：[c6da3f32b413b20e7f3daf812e6669ab2a8840b4](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/c6da3f32b413b20e7f3daf812e6669ab2a8840b4)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
