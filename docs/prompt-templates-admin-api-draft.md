# `prompt_templates` 后台管理 API 草案

更新时间：2026-06-03

适用范围：`D:\gpt_image_playground-main`

## 0. 当前有效简化范围

2026-06-08 起，提示词模板后台 API 第一版按 `docs/admin-backend-minimal-scope.md` 执行。本文后续较复杂的上下架、推荐位、排序、批量状态、复杂筛选和统计接口只作为历史参考，不作为当前实现范围。

当前只保留两类后台动作：

1. 来源搬运：管理员提交网址或 GitHub 仓库链接，后端抓取内容、下载图片到本地、按规则筛选候选精品，候选项进入人工审核。
2. 手工添加：管理员每次手工添加一个官方提示词模板。

建议第一版 API 收敛为：

```text
POST /api/admin/templates/import-runs
GET  /api/admin/templates/candidates
POST /api/admin/templates/candidates/:id/approve
POST /api/admin/templates/candidates/:id/reject
GET  /api/admin/templates
POST /api/admin/templates
PATCH /api/admin/templates/:id
```

不优先实现批量发布、拖拽排序、推荐位、模板版本历史、评论管理、A/B 实验。

## 1. 目的

本草案曾用于定义官方模板后台管理的较完整 API 边界；当前第一版已收敛为更轻的搬运、审核、单条添加流程。

它服务于：

1. 管理后台的官方模板管理模块
2. 前台提示词库从静态数据切到服务端数据
3. 模板的上下架、推荐位、排序和来源治理

本文件基于：

- `docs/prompt-templates-schema-draft.md`
- `docs/admin-backend-development-plan.md`

## 2. 设计边界

第一版只管理：

- 官方模板

第一版不管理：

- 我的模板
- 最近使用
- 用户收藏状态
- 模板评论
- 复杂审核流

API 命名建议统一走：

- `/api/admin/templates/*`

前台公开读取建议后续单独走：

- `/api/templates/*`

不要直接复用后台接口给普通前台。

## 3. 权限模型

建议权限分层：

- `super_admin`
  - 可增删改查
  - 可上下架
  - 可改排序
  - 可改来源信息

- `operator`
  - 可查看
  - 可编辑内容
  - 可上下架
  - 可改推荐位
  - 不建议删除

- `support`
  - 默认只读

高风险操作建议写审计日志：

- 删除模板
- 批量上下架
- 改来源信息
- 改排序

## 4. 数据对象

后台接口中的模板对象建议与 schema 草案保持一致：

- `id`
- `slug`
- `title`
- `summary`
- `category`
- `ratio`
- `prompt`
- `negativePrompt`
- `guidance`
- `tags`
- `templateType`
- `status`
- `reviewStatus`
- `featured`
- `sortOrder`
- `coverStyle`
- `sourceName`
- `sourceAuthor`
- `sourceUrl`
- `license`
- `importBatch`
- `reviewNote`
- `editorNote`
- `usageCount`
- `favoriteCount`
- `createdAt`
- `updatedAt`
- `publishedAt`

## 5. API 列表

### 5.1 获取模板列表

`GET /api/admin/templates`

用途：

- 后台列表页
- 条件筛选
- 排序查看

支持查询参数：

- `keyword`
- `category`
- `templateType`
- `status`
- `featured`
- `sourceName`
- `importBatch`
- `page`
- `pageSize`
- `sortBy`
- `sortOrder`

返回示意：

```json
{
  "items": [
    {
      "id": "brand-premium-claw-machine",
      "slug": "brand-premium-claw-machine",
      "title": "品牌世界观抓娃娃机",
      "category": "品牌广告",
      "templateType": "showcase",
      "status": "published",
      "featured": true,
      "sortOrder": 120,
      "sourceName": "Awesome-GPT4o-Image-Prompts",
      "updatedAt": "2026-06-03T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 25
  }
}
```

### 5.2 获取模板详情

`GET /api/admin/templates/:id`

用途：

- 后台详情页
- 编辑页回填

返回完整模板对象。

### 5.3 创建模板

`POST /api/admin/templates`

用途：

- 后台新增官方模板
- 手工录入模板

请求示意：

```json
{
  "slug": "poster-concept-typography",
  "title": "概念字体主视觉海报",
  "summary": "适合做一句标题撑起整张海报的方向。",
  "category": "海报插画",
  "ratio": "2:3",
  "prompt": "Create one finished premium conceptual typography poster...",
  "negativePrompt": "避免默认字库感...",
  "guidance": [
    "标题必须短。",
    "适合活动主海报。"
  ],
  "tags": ["字体海报", "编辑感", "概念视觉"],
  "templateType": "structured",
  "status": "draft",
  "featured": true,
  "sortOrder": 80,
  "coverStyle": "linear-gradient(...)",
  "sourceName": "awesome-gpt-image-2",
  "sourceAuthor": null,
  "sourceUrl": "https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md",
  "license": "MIT",
  "importBatch": "2026-06-batch-1"
}
```

### 5.4 更新模板

`PATCH /api/admin/templates/:id`

用途：

- 编辑标题、摘要、提示词、标签、来源等

建议：

- 支持部分字段更新
- 服务端统一更新时间

### 5.5 删除模板

`DELETE /api/admin/templates/:id`

用途：

- 删除误导入或废弃模板

建议：

- 第一版更推荐软删除，或直接改 `status=archived`
- 真删除必须记录审计日志

### 5.6 上下架模板

`POST /api/admin/templates/:id/publish`

`POST /api/admin/templates/:id/archive`

用途：

- 单条模板发布
- 单条模板下架

建议：

- `publish` 时自动写入 `publishedAt`
- `archive` 不清除原始内容

### 5.7 设置推荐位

`POST /api/admin/templates/:id/feature`

`POST /api/admin/templates/:id/unfeature`

用途：

- 设置或取消推荐模板

建议：

- 只改 `featured`
- 不隐式修改排序

### 5.8 调整排序

`POST /api/admin/templates/reorder`

用途：

- 后台拖拽排序
- 批量更新 `sortOrder`

请求示意：

```json
{
  "items": [
    { "id": "brand-premium-claw-machine", "sortOrder": 120 },
    { "id": "campaign-sports-launch", "sortOrder": 110 },
    { "id": "poster-concept-typography", "sortOrder": 100 }
  ]
}
```

### 5.9 批量更新状态

`POST /api/admin/templates/bulk-status`

用途：

- 批量发布
- 批量归档

请求示意：

```json
{
  "ids": [
    "brand-premium-claw-machine",
    "campaign-sports-launch"
  ],
  "status": "published"
}
```

### 5.10 批量导入元信息登记

`POST /api/admin/templates/import-batch`

用途：

- 记录一批模板导入来源
- 后续可接真正导入能力

第一版可以很轻：

- 只登记批次信息
- 不要求一开始就做上传文件导入

### 5.11 获取筛选项

`GET /api/admin/templates/meta`

用途：

- 返回分类
- 返回模板类型
- 返回来源名
- 返回状态枚举

返回示意：

```json
{
  "categories": ["海报插画", "人像摄影", "产品静物", "空间氛围", "品牌广告", "UI / 社媒视觉"],
  "templateTypes": ["showcase", "reusable", "structured"],
  "statuses": ["draft", "published", "archived"],
  "sourceNames": ["Awesome-GPT4o-Image-Prompts", "awesome-gpt-image-2"]
}
```

## 6. 前台公开读取 API 建议

虽然本文件重点是后台 API，但为了后续前台切换，建议同步约定：

### 6.1 获取前台模板列表

`GET /api/templates`

只返回：

- `status=published`
- 可公开字段

### 6.2 获取前台模板详情

`GET /api/templates/:id`

只返回前台需要字段，不返回后台备注等治理字段。

## 7. 字段校验建议

### 7.1 创建 / 更新时建议校验

- `title` 必填
- `summary` 必填
- `category` 必填
- `ratio` 必填
- `prompt` 必填
- `templateType` 必填
- `status` 必填
- `coverStyle` 必填

### 7.2 约束建议

- `slug` 唯一
- `sortOrder` 必须为整数
- `tags` 必须是字符串数组
- `guidance` 必须是字符串数组
- `status` 只能在枚举中
- `templateType` 只能在枚举中

## 8. 审计日志建议

以下接口建议写入 `admin_audit_logs`：

- `POST /api/admin/templates`
- `PATCH /api/admin/templates/:id`
- `DELETE /api/admin/templates/:id`
- `POST /api/admin/templates/:id/publish`
- `POST /api/admin/templates/:id/archive`
- `POST /api/admin/templates/:id/feature`
- `POST /api/admin/templates/:id/unfeature`
- `POST /api/admin/templates/reorder`
- `POST /api/admin/templates/bulk-status`

建议记录：

- 操作人
- 操作时间
- 操作类型
- 目标模板 ID
- 关键字段变更摘要

## 9. 第一版不建议做的接口

第一版先不做：

- 模板版本历史 diff
- 模板评论管理
- 模板协作审批流
- 模板内容 A/B 实验
- 用户个人模板后台管理

## 10. 推荐下一步

基于当前 schema 和 API 草案，下一步最合适的是：

1. 官方模板后台页面信息架构
2. 模板静态数据到服务端的迁移草案
3. 再决定先做接口实现还是先做后台 UI 原型

## 11. 当前判断

模板后台管理 API 的第一版边界已经足够明确。

后续不需要再继续扩大前台静态模板规模，应该逐步转向：

`schema -> API -> 后台管理 -> 前台服务端化`
