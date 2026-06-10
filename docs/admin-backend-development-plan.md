# 管理后台开发计划

更新时间：2026-06-09

适用范围：`D:\gpt_image_playground-main`

> 当前后台完整规划已更新为：`docs/admin-backend-system-design.md`。
> 本文件保留为历史阶段参考；如果两者冲突，以 `docs/admin-backend-system-design.md` 为准。

## 1. 定位

管理后台是独立系统，不属于普通用户前台。

它服务于：

- 运营
- 客服
- 财务
- 技术运维

它不承担：

- 普通用户创作入口
- 普通用户提示词工具页
- 普通用户作品浏览入口

## 2. 与当前前台的关系

当前项目主线是`标准版 / 商业化图像创作平台`。

后台是当前平台主线的一部分，但要遵守两条规则：

1. 后台独立规划、独立实现，不混进前台叙事。
2. 后台的模型、订单、计费、Gateway 能力，必须与前台共用 Node API + PostgreSQL 数据源。

## 3. 启动前提

不建议立刻从后台 UI 开始。

建议先确认：

1. 前台主流程已基本稳定。
2. 普通用户认证方案明确为邮箱体系。
3. 余额、订单、扣点、任务记录的数据边界已确定。
4. Gateway route / SKU / diagnostics 结构基本稳定。
5. 管理员认证和权限边界明确。

## 4. 第一版后台角色

### 4.1 Super Admin

- 全部后台能力
- 管理管理员账号
- 管模型、线路、权限、关键配置

### 4.2 Operator

- 查用户
- 查订单
- 查扣点流水
- 查 Gateway 诊断
- 处理充值异常
- 临时停用线路

### 4.3 Support

- 查用户基础状态
- 查订单和扣点记录
- 不改价格
- 不改线路关键配置
- 不接触密钥

## 5. 第一版后台模块

### 5.1 后台认证与权限

- 管理员登录
- 管理员会话
- 角色权限
- 操作日志

规则：

- 与普通用户登录分离
- 高风险操作必须记录审计日志

### 5.2 Dashboard

- 今日生成数
- 今日成功率
- 今日扣点
- 今日充值
- 异常线路数
- 最近失败请求

第一版保持轻量即可，不做复杂 BI。

### 5.3 用户管理

- 用户列表
- 用户详情
- 余额查看
- 充值记录
- 扣点记录
- 手动余额调整
- 冻结 / 解冻

规则：

- 手动加减点必须写流水

### 5.4 订单与充值

- 订单列表
- 订单详情
- 支付状态筛选
- 手动补单

### 5.5 扣点与用量

- 扣点流水列表
- 关联任务
- 关联用户
- 失败不扣点记录查看

### 5.6 模型 SKU 管理

- SKU 列表
- 启用 / 停用
- 参数边界
- 默认规则
- 绑定 routeIds

### 5.7 Gateway 线路管理

- route 列表
- create / edit / disable
- 优先级
- 并发
- timeout
- capability flags
- apiKeyRef

规则：

- 不在前端暴露真实 API Key
- 线路修改必须有审计日志

### 5.8 Gateway 诊断与人工控制

- route health
- latest request
- failure kind
- attempts
- 手动停用 / 恢复线路

### 5.9 官方模板管理

- 官方模板列表
- 新增 / 编辑
- 分类 / 标签
- 推荐位
- 上下架
- 排序
- 来源信息管理

说明：

- 第一版只管理官方模板
- 用户个人模板先不进后台

### 5.10 系统设置

- 充值包配置
- 帮助文案
- 公告文案
- 计费规则说明
- 功能开关

## 6. 推荐核心表

第一版建议优先明确：

- `users`
- `admin_users`
- `admin_audit_logs`
- `accounts`
- `recharge_orders`
- `usage_records`
- `generation_tasks`
- `model_skus`
- `gateway_routes`
- `gateway_route_overrides`
- `gateway_route_metrics`
- `prompt_templates`

## 7. API 边界

后台 API 建议独立：

- `/api/admin/auth/*`
- `/api/admin/users/*`
- `/api/admin/orders/*`
- `/api/admin/usage/*`
- `/api/admin/model-skus/*`
- `/api/admin/gateway-routes/*`
- `/api/admin/gateway-diagnostics/*`
- `/api/admin/templates/*`

普通用户前台 API 保持独立，不混权限。

## 8. 实施顺序

### Phase Admin 0：后台前置设计

1. 明确服务运行形态
2. 明确数据库
3. 明确管理员认证
4. 明确普通用户认证
5. 明确是否继续以 Worker 为主，或引入独立服务

### Phase Admin 1：运营最小闭环

1. 管理员登录
2. 用户列表 / 详情
3. 充值订单列表
4. 扣点流水列表
5. 手动余额调整 + 审计日志

### Phase Admin 2：Gateway 运维后台

1. Route 列表
2. SKU 列表
3. Diagnostics 页面
4. 手动停用 / 恢复线路

### Phase Admin 3：内容与配置

1. 官方模板管理
2. 充值包配置
3. 公告 / 帮助文案配置
4. 功能开关

## 9. 当前不建议立即做

- 不先做完整后台 UI 再补后端
- 不把后台入口塞进普通前台
- 不让普通用户看到 route / provider / key 细节
- 不在 V1 阶段先做复杂优惠、会员和多租户

## 10. 下一步产出建议

后台真正该先补的是这些文档和边界：

1. 后端架构选择
2. 数据库 schema 草案
3. 用户 / 订单 / 扣点 API 草案
4. Gateway route / SKU 管理 API 草案
5. `prompt_templates` schema 草案
6. 模板管理 API 草案
7. 后台页面信息架构
