# 第三方余额码充值方案

更新时间：2026-06-08

适用范围：`D:\gpt_image_playground-main`

## 1. 背景

当前充值方向改为：

- 用户先到第三方小铺购买余额码。
- 用户回到本站粘贴余额码。
- 本站校验余额码并给账号加点数。

参考流程来自用户提供的第三方充值网站：`https://catfk.com/`。

这不是站内直连支付，也不是支付回调方案。第一版只做“外部购买 + 本站兑换”的轻量闭环。

## 2. 产品边界

第一版本站负责：

- 展示当前点数余额。
- 提供第三方购买入口。
- 提供余额码输入框。
- 校验余额码。
- 成功后给当前账号增加点数。
- 记录兑换流水。

第一版第三方负责：

- 收款。
- 发放余额码。
- 用户付款问题处理。

第一版不做：

- 站内微信 / 支付宝 / 银行卡支付。
- 支付状态轮询。
- 第三方支付回调。
- 自动从第三方同步订单。
- 导入第三方已经生成的码。
- 提现、退款、返利、推荐奖励。
- 复杂优惠券和活动套餐。

## 3. 前台流程

### 3.1 登录前

- 充值页显示“登录后可兑换余额码”。
- `购买余额码` 可以展示，但兑换输入框应禁用或引导登录。

### 3.2 已登录

1. 用户打开充值页。
2. 页面显示当前点数余额。
3. 用户点击 `购买余额码`，新窗口打开第三方小铺。
4. 用户在第三方完成付款并复制余额码。
5. 用户回本站粘贴余额码。
6. 点击 `兑换入账`。
7. 本站后端校验成功后更新余额。
8. 页面显示最近兑换记录。

### 3.3 失败状态

需要明确区分：

- 兑换码不存在。
- 兑换码已使用。
- 兑换码已过期。
- 兑换码已停用。
- 当前用户无权限兑换。
- 服务端处理失败。

前台不要展示过多内部信息，只显示可行动结果。

## 4. 数据模型草案

### 4.1 `recharge_codes`

用途：保存可兑换余额码。

字段建议：

- `id`
- `codeHash`
- `codeValue`
- `codePreview`
- `points`
- `status`
- `batchId`
- `batchNo`
- `sequenceNo`
- `expiresAt`
- `redeemedByUserId`
- `redeemedAt`
- `createdAt`
- `updatedAt`
- `adminNote`

`status` 建议：

- `active`
- `redeemed`
- `expired`
- `disabled`

规则：

- PostgreSQL 生产后端必须保存 `code_hash`、`code_preview` 和 `code_value`。
- 用户提交明文码后，后端统一 hash 再匹配。
- `code_value` 只用于后台导出第三方小铺库存 TXT；普通用户接口不返回完整码。
- TXT 导出格式为一行一个完整充值码。
- 已有旧数据如果只有 `code_hash` 和 `code_preview`，无法反推出完整充值码，不能补造。
- 同一个码只能成功兑换一次。

### 4.2 `balance_ledger`

用途：保存账户余额流水。

字段建议：

- `id`
- `userId`
- `type`
- `amount`
- `balanceBefore`
- `balanceAfter`
- `relatedId`
- `note`
- `createdAt`

`type` 建议：

- `recharge_code_redeem`
- `generation_charge`
- `refund`
- `admin_adjustment`

### 4.3 `accounts`

用途：保存服务端权威余额。

字段建议：

- `userId`
- `balance`
- `frozenBalance`
- `updatedAt`

说明：

- 前台本地余额只能作为临时 UI 状态。
- 真实兑换后必须以服务端余额为准。

## 5. API 草案

### 5.1 兑换余额码

`POST /api/recharge-codes/redeem`

请求：

```json
{
  "code": "XXXX-XXXX-XXXX"
}
```

成功返回：

```json
{
  "ok": true,
  "points": 100,
  "balanceBefore": 20,
  "balanceAfter": 120,
  "redeemedAt": "2026-06-06T10:00:00Z"
}
```

失败返回：

```json
{
  "ok": false,
  "error": "code_already_redeemed",
  "message": "该余额码已被兑换"
}
```

### 5.2 查询兑换记录

`GET /api/recharge-codes/redemptions`

用途：

- 前台充值页展示最近兑换记录。

### 5.3 管理后台创建余额码

`POST /api/admin/recharge-codes`

用途：

- 管理员按面额和数量生成余额码。
- 系统自动生成批次编号。
- 系统自动生成兑换码编号。
- 管理员按批次导出 TXT，再导入第三方小铺库存。

V1 已实现一个轻量 API 入口，使用 `Authorization: Bearer <token>` 保护：

```json
{
  "points": 100,
  "count": 10
}
```

当前实现约束：

- 仅允许 `30 / 100 / 300` 点。
- 批次编号由系统生成，不要求管理员手填。
- 兑换码编号由系统生成，不要求管理员手填。
- 当前生产主线改为 PostgreSQL 的 `recharge_code_batches`、`recharge_codes`、`accounts`、`balance_ledger` 和 `admin_audit_logs`。
- 旧 KV / D1 充值码能力只作为历史或本地参考，不作为当前生产主线。
- TXT 导出依赖 `recharge_codes.code_value`；PostgreSQL 初始迁移必须直接包含该字段。
- `code_value` 只保存后台生成或导入时的完整码；历史 hash-only 行不能恢复完整码，TXT 导出不会输出这类旧行。
- 当前本地联调后台入口为 `/admin`，默认端口 `4175`。

本地操作脚本：

- 已新增 `npm run recharge-codes:admin`，用于当前平台后台直接调用 `POST /api/admin/recharge-codes`。
- 默认地址：`http://127.0.0.1:4175/api/admin/recharge-codes`
- 默认令牌来源：`RECHARGE_CODE_ADMIN_TOKEN`，若未提供则回退 `IMAGE_GATEWAY_ADMIN_TOKEN`
- 固定采用“本站按批次生成码 -> TXT 导入第三方小店库存 -> 用户购买后回本站兑换”的流程。

后台页面当前提供 TXT 导出入口，面向第三方小铺库存导入：

- 文件名：`recharge-codes-YYYY-MM-DD.txt`
- 内容：一行一个完整充值码
- 范围：当前实现导出 active 状态、最多 1000 条、且存在 `code_value` 的充值码

生成新码示例：

```bash
npm run recharge-codes:admin -- --generate --points 100 --count 5
```

生成可直接粘贴到小店库存的纯文本卡密：

```bash
npm run recharge-codes:admin -- --generate --points 30 --count 20 --codes-only
```

第一版不提供第三方已有码导入命令。充值码统一由本站后台生成后导出 TXT。

也可以直接用 `curl`：

```bash
curl -X POST http://127.0.0.1:4175/api/admin/recharge-codes \
  -H "Authorization: Bearer $RECHARGE_CODE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"points":100,"count":5}'
```

端到端验证脚本：

- 已新增 `npm run recharge-codes:verify`，用于验证“生成一个测试码 -> 指定用户兑换 -> 校验余额变化”。
- 默认地址：`http://127.0.0.1:4175`
- 默认用户：`verify-user`
- 默认面额：`30`

示例：

```bash
npm run recharge-codes:verify -- --points 30 --user-id mock-tester
```

本项目本地联调统一使用 `4175`。如果确实需要改地址，请显式传入 `--base-url`，不要复用其他项目占用的端口。

### 5.4 管理后台查询余额码

`GET /api/admin/recharge-codes`

支持筛选：

- `status`
- `points`
- `keyword`
- `page`
- `pageSize`

## 6. 后端兑换规则

兑换动作必须放在事务里处理：

1. 查找 `codeHash`。
2. 锁定该余额码记录。
3. 校验状态、过期时间和使用状态。
4. 锁定用户账户。
5. 增加账户余额。
6. 将余额码标记为 `redeemed`。
7. 写入 `balance_ledger`。
8. 返回新余额。

必须防止：

- 同一兑换码并发兑换两次。
- 前端伪造点数。
- 失败重试导致重复入账。

## 7. 前台页面改造方向

当前 `RechargeAndResultView.tsx` 应从“模拟支付页”改为“余额码兑换页”。

建议保留：

- 当前账号状态。
- 当前余额。
- 结果状态。
- 最近充值 / 兑换记录。

建议移除或改写：

- `微信支付 / 支付宝 / 银行卡` 支付方式选择。
- `去支付` 按钮。
- `支付处理中` 模拟状态。
- 前端直接加余额的模拟成功按钮。

建议新增：

- `购买余额码` 外部链接按钮。
- `余额码` 输入框。
- `兑换入账` 按钮。
- `兑换说明` 简短步骤。
- 最近兑换记录。

## 8. 管理后台影响

后台 `订单与充值` 模块需要扩展为：

- 余额码列表。
- 余额码详情。
- 批量生成余额码。
- 禁用余额码。
- 查看兑换人和兑换时间。
- 兑换异常处理。

高风险操作必须写审计日志：

- 批量生成余额码。
- 禁用未使用余额码。
- 手动给用户补点。
- 修改余额码状态。

## 9. 与当前点数规则的关系

余额码仍按当前点数面额发放：

- `30 点`
- `100 点`
- `300 点`

前台用户看到的是点数，不直接暴露第三方成本结构。

扣点规则按当前平台标准执行：

- 仅成功产出最终图片后扣点。
- 失败或取消不扣点。
- 按分辨率档位、质量档位和最终成功图片数量计算扣点。

## 10. 推荐实施顺序

1. 先把前台充值页文案改为余额码模式。
2. 保留本地模拟兑换，用于页面验证。
3. 再补后端 schema 和 API。
4. 后端兑换接口完成后，前台切换为真实兑换。
5. 最后补管理后台余额码管理能力。
