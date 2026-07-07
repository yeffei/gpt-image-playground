# 发布前最终状态说明

Updated: 2026-06-15
Scope: `D:\gpt_image_playground-main`

## 当前目标

对当前“线路准入 / 2K4K / 平台能力 / 发布收尾”主线做发布前收口说明。

这份说明用于回答四件事：

1. 这条主线目前完成到了哪里。
2. 哪些验证已经通过。
3. 哪些内容建议纳入本次发布范围。
4. 还有哪些风险点没有被这轮验证覆盖。

## 当前结论

当前 A 组主线已经达到“可收口状态”。

这里的“可收口”指：

- 相关最小测试已通过。
- 服务端构建已通过。
- 前端构建已通过。
- 仓库级部署契约检查已通过。
- 发布范围已完成拆组，不再建议整包处理当前 worktree。

当前不代表：

- 已验证真实生产环境 `env` 文件。
- 已验证真实外部线路 `preflight` 或 `live image verify`。
- 已执行 `git commit`、`push` 或 `PR`。

## 已完成内容

### 1. 后台线路准入闭环

- 后台已具备新线路准入操作流：
  - 创建线路
  - 检查连通性
  - 实测 2K / 4K
  - 再绑定模型上线
- 已补充后台准入文档：
  - [gateway-route-admission-guide.md](/D:/gpt_image_playground-main/docs/gateway-route-admission-guide.md)

### 2. 后端能力收口

- 后端支持记录线路 `max_supported_long_edge`
- 平台能力接口聚合模型可用尺寸与能力上限
- 前台不再自己猜单条线路能力，而是读取后端聚合结果

### 3. 前台能力跟随

- 尺寸选择器可跟随后端能力收口
- 输出数量上限跟随模型能力
- 结果展示可解释部分成功、请求数量、扣点等信息

### 4. 部署与发布辅助文档

- 中文部署执行单：
  - [deployment-operator-runbook.md](/D:/gpt_image_playground-main/docs/deployment-operator-runbook.md)
- 当前 worktree 发布范围盘点：
  - [release-scope-inventory-2026-06-15.md](/D:/gpt_image_playground-main/docs/release-scope-inventory-2026-06-15.md)

## 已验证结果

本轮已执行并通过：

```powershell
npm test -- server/src/gatewayModels.test.ts src/lib/gatewayRouteAdmission.test.ts src/lib/platformCapabilitiesDisplay.test.ts src/lib/outputResolutionQuality.test.ts src/lib/taskResultDisplay.test.ts
```

结果：

- `5` 个测试文件通过
- `23` 个测试通过

已执行并通过：

```powershell
npm run server:build
npm run build
npm run verify:server-deploy-config
```

结果：

- `server:build` 通过
- `build` 通过
- `verify:server-deploy-config` 返回 `ok: true`

附加说明：

- `verify:server-deploy-config` 本轮没有设置 `SERVER_DEPLOY_ENV_FILE`
- 因此它验证的是“仓库部署契约”，不是具体生产环境文件

## 建议纳入本次发布的范围

本次建议只围绕 A 组主线收口。

以 [release-scope-inventory-2026-06-15.md](/D:/gpt_image_playground-main/docs/release-scope-inventory-2026-06-15.md) 为准，重点包括：

- 后端线路探测、能力聚合、模型绑定相关代码
- 后台准入 UI 和后台 API
- 前台尺寸收口、结果展示、平台能力读取
- 验证脚本与准入说明文档
- 部署执行与发布范围文档

## 不建议混入本次发布的内容

本轮不建议混入：

- `提示词安全 / 提示词库 / 优化器体验` 这条并行主线
- 本地日志和临时产物
- 评审材料类文件

典型不建议混入项见：

- [release-scope-inventory-2026-06-15.md](/D:/gpt_image_playground-main/docs/release-scope-inventory-2026-06-15.md)

## 当前剩余风险

当前还没有覆盖的风险点主要有三类：

### 1. 真实生产环境未校验

- 还没有用真实 `SERVER_DEPLOY_ENV_FILE` 跑部署契约检查
- 还没有确认真实生产 `DATABASE_URL`、反向代理、图片持久化目录

### 2. 真实外部线路未校验

- 还没有执行真实 `gateway:routes:preflight`
- 还没有执行真实 `verify:image:live`
- 原因是这些操作会触达外部线路，且可能消耗额度

### 3. worktree 仍然很大

- 当前仓库不是干净 worktree
- 即使 A 组主线现在可收口，也不建议直接整包提交

## 当前建议的下一动作

按优先级建议：

1. 如果只是继续收尾，不碰 git：
   - 用本说明 + 发布范围盘点作为交接材料即可。
2. 如果要进入真正提交准备：
   - 先只处理 A 组文件，再决定是否 stage。
3. 如果要进入部署准备：
   - 提供真实环境文件路径，单独跑一次 `SERVER_DEPLOY_ENV_FILE` 校验。
4. 如果要做发布前最终线路确认：
   - 明确授权后再跑真实线路 `preflight` / `live image verify`。

## 当前明确未做的事

- 未做 `git commit`
- 未做 `push`
- 未做 `PR`
- 未删除日志文件
- 未跑真实外部线路验证
- 未验证具体生产环境文件

