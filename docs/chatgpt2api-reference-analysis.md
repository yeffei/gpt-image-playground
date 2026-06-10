# chatgpt2api 可借鉴点

Updated: 2026-06-03
Scope: `D:\gpt_image_playground-main`
Reference: `https://github.com/basketikun/chatgpt2api`

## 目的

这份文档只记录对当前项目有用的结论，不做完整仓库分析。

当前只关心两件事：

- 对我们的线路调度有没有值得借的做法
- 对我们的提示词优化器有没有值得借的边界设计

## 结论

`chatgpt2api` 对本项目真正有价值的，不是整套实现，而是几个调度和边界上的思路。

可直接吸收的方向：

- 先过滤不可用候选，再做排序
- 明确表示“什么时候恢复可用”
- 把并发限制放进调度层
- 在网关层做请求归一化
- 把内容审核和提示词优化分开

## 对线路调度的可借鉴点

## 1. 先过滤，再排序

这点和我们当前方向一致，值得继续强化。

我们现在已经有这些过滤条件：

- route 是否静态启用
- 是否支持当前 `modelSku`
- 是否支持 `edit` / `mask`
- 是否达到 `maxConcurrency`
- 是否被人工 override 禁用

下一步建议不是改调度策略，而是把这些过滤结果结构化输出到 diagnostics。

建议补充的排除原因：

- `operator_disabled`
- `cooldown_active`
- `unsupported_edit`
- `unsupported_mask`
- `max_concurrency_reached`
- `missing_model_mapping`

这样后续运维判断会更直接。

## 2. 恢复时间要更直观

`chatgpt2api` 里有类似 `restore_at` 的思路，这个对我们有参考价值。

映射到我们项目里，不需要新增一套状态源，只需要在 diagnostics 里给出更直观的派生字段即可。

建议：

- 保持现有真实字段不变
  - `cooldownUntil`
  - `disabledUntil`
- 在 diagnostics 里新增一个只读派生字段
  - `restoresAt`

推荐取值顺序：

1. `disabledUntil`
2. `cooldownUntil`

这样 ops 看一眼就知道线路大概何时恢复，不必自己判断多个字段。

## 3. 并发限制属于调度本体

这一点值得继续保留，不要把调度退化成只看优先级或延迟。

我们当前已经有：

- `maxConcurrency`
- `inFlight`

后续保持：

- 并发继续作为线路可参与性的前置判断
- 不在普通前台暴露
- 后续如果线路数继续增加，再考虑更细的软惩罚或等待策略

当前 V1 不需要更复杂。

## 对提示词优化器的可借鉴点

## 1. 输入要做轻量归一化

`chatgpt2api` 给我们的启发不是“它有现成优化器”，而是“辅助模型的输入边界要干净”。

对我们来说，提示词优化器接入时建议继续坚持：

- 只传必要上下文
- 不把原始图片字节直接塞给纯文本优化模型
- 控制上下文长度
- 优化器输出结构单独定义，不和审核共用

这和当前文档方向一致：

- `docs/prompt-optimizer-unified-design.md`

## 2. 审核和优化不要混

如果以后要加安全审核，它应该是后台独立能力，不要和“优化提示词”这个用户功能绑在一起。

建议边界保持为：

- `prompt optimizer`：帮助用户把提示词整理得更可执行
- `review / moderation`：后台判断请求是否允许继续

这两者不要共用一套交互入口，也不要共用一套输出格式。

## 对当前项目的建议下一步

基于这次参考分析，最值得做的还是当前主线上的小增强：

## 1. 给 diagnostics 增加结构化 exclusion reasons

目标：

- 让每条线路为什么没参与调度变得一眼可见
- 仅限 ops / diagnostics 使用

## 2. 给 diagnostics 增加 `restoresAt`

目标：

- 统一表达“这条线路大概何时恢复”
- 不改现有调度真实逻辑

## 3. 提示词优化器继续保持独立边界

目标：

- 以后做 optimizer 时，继续走轻量输入、结构化输出
- 不把审核逻辑混进优化器产品体验里

## 决策

这次参考的有效吸收点，收口为三句话：

- 线路调度继续坚持“先过滤、再排序、真实失败再切换”
- diagnostics 应该更清楚地表达“为什么不可用、什么时候恢复”
- 提示词优化器和内容审核必须分层实现
