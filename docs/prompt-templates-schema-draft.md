# `prompt_templates` 服务端 Schema 草案

更新时间：2026-06-03

适用范围：`D:\gpt_image_playground-main`

## 1. 目的

本草案用于把当前前台静态官方模板，过渡到可服务端管理的模板数据模型。

它服务于三件事：

1. 官方模板后台管理
2. 前台提示词库服务端化
3. 后续模板版本、上下架、推荐位和来源治理

本文件是模板后台化前置设计文档，不是最终数据库迁移文件。

## 2. 当前输入来源

当前前台模板主要来自：

- `src/lib/promptLibrary.ts`

当前前台已具备这些字段基础：

- `id`
- `title`
- `summary`
- `category`
- `ratio`
- `tags`
- `prompt`
- `negativePrompt`
- `guidance`
- `featured`
- `templateType`
- `sourceName`
- `sourceAuthor`
- `sourceUrl`
- `license`

因此服务端 schema 不需要从零猜测，可以在现有字段上收口。

## 3. 设计原则

### 3.1 先支持官方模板

第一版 `prompt_templates` 只服务官方模板。

不把“我的模板”混进同一张表直接管理。

### 3.2 先做内容治理，不先做复杂协作

第一版重点是：

- 存储
- 查询
- 上下架
- 推荐位
- 排序
- 来源管理

第一版不追求：

- 多人协同编辑
- 复杂审核工作流
- 可视化 diff

### 3.3 兼容前台现有展示

字段命名应尽量能平滑映射当前前台。

避免为了“数据库纯度”把前台现有结构全部推翻。

### 3.4 兼容后续扩展

第一版虽然只管官方模板，但字段要为后续预留：

- 发布状态
- 推荐排序
- 导入批次
- 使用统计
- 收藏统计

## 4. 建议表结构

表名：

- `prompt_templates`

建议字段：

### 4.1 主键与基础标识

- `id`
  - `uuid` 或稳定字符串主键
  - 主键

- `slug`
  - `varchar`
  - 唯一
  - 用于后台链接、前台路由或未来公开模板链接

### 4.2 基础展示字段

- `title`
  - `varchar(120)`

- `summary`
  - `text`

- `category`
  - `varchar(64)`

- `ratio`
  - `varchar(16)`
  - 例如：`1:1`、`4:5`、`16:9`

### 4.3 Prompt 内容字段

- `prompt`
  - `text`

- `negative_prompt`
  - `text`
  - 可为空

- `guidance`
  - `json`
  - 建议为字符串数组

### 4.4 分类与标签字段

- `tags`
  - `json`
  - 建议为字符串数组

- `template_type`
  - `varchar(32)`
  - 建议枚举：
    - `showcase`
    - `reusable`
    - `structured`

### 4.5 展示与运营字段

- `status`
  - `varchar(32)`
  - 建议枚举：
    - `draft`
    - `published`
    - `archived`

- `is_featured`
  - `boolean`

- `sort_order`
  - `int`
  - 默认 `0`

- `cover_style`
  - `text`
  - 当前前台使用的是渐变字符串，可先直接保留

### 4.6 来源与版权字段

- `source_name`
  - `varchar(128)`

- `source_author`
  - `varchar(128)`
  - 可为空

- `source_url`
  - `text`
  - 可为空

- `license`
  - `varchar(64)`
  - 可为空

- `import_batch`
  - `varchar(64)`
  - 例如：`2026-06-imgedify-batch-1`

### 4.7 内容治理字段

- `review_status`
  - `varchar(32)`
  - 建议枚举：
    - `pending`
    - `approved`
    - `rejected`

- `review_note`
  - `text`
  - 可为空

- `editor_note`
  - `text`
  - 可为空

### 4.8 统计字段

- `usage_count`
  - `int`
  - 默认 `0`

- `favorite_count`
  - `int`
  - 默认 `0`

### 4.9 时间字段

- `created_at`
  - `datetime`

- `updated_at`
  - `datetime`

- `published_at`
  - `datetime`
  - 可为空

## 5. 推荐索引

建议索引：

1. `slug` 唯一索引
2. `status, sort_order`
3. `category, status`
4. `template_type, status`
5. `is_featured, status`
6. `source_name`
7. `import_batch`

如果后续搜索量上来，再考虑：

- `title`
- `summary`
- `tags`

的全文检索方案。

## 6. 建议枚举值

### 6.1 `category`

第一版先兼容当前前台：

- `海报插画`
- `人像摄影`
- `产品静物`
- `空间氛围`
- `品牌广告`
- `UI / 社媒视觉`

后续如果后台成熟，再考虑拆成：

- 主分类
- 子分类

当前先不拆，避免过早复杂化。

### 6.2 `template_type`

- `showcase`
  - 更偏展示和灵感入口

- `reusable`
  - 更偏通用复用

- `structured`
  - 更偏结构化骨架

### 6.3 `status`

- `draft`
  - 后台可见，前台不可见

- `published`
  - 前台可见

- `archived`
  - 后台保留，前台隐藏

### 6.4 `review_status`

- `pending`
- `approved`
- `rejected`

第一版如果不做正式审核流，也可以先让它默认跟随 `status`。

## 7. 建议 JSON 结构

### 7.1 `tags`

```json
["电影感", "高级感", "情绪海报"]
```

### 7.2 `guidance`

```json
[
  "先替换主体身份与情绪，再决定背景叙事层级。",
  "适合继续追加镜头语言、服装材质和海报文案位置要求。",
  "如果要更商业，可以补充品牌色与画面主道具。"
]
```

## 8. 前台映射建议

服务端返回给前台时，可以直接映射为现有结构：

- `negative_prompt` -> `negativePrompt`
- `template_type` -> `templateType`
- `is_featured` -> `featured`
- `source_name` -> `sourceName`
- `source_author` -> `sourceAuthor`
- `source_url` -> `sourceUrl`
- `cover_style` -> `image`

这样前台可以逐步从静态数据切换到接口数据，而不需要一次性重写页面组件。

## 9. 第一版不建议放进这张表的内容

不建议第一版直接放进 `prompt_templates`：

- 用户个人模板
- 用户最近使用
- 用户收藏状态
- 模板评论
- 模板版本 diff 记录

这些更适合后续用独立表管理。

## 10. 关联关系建议

第一版可先只做单表。

后续可能增加：

- `prompt_template_tags`
- `prompt_template_versions`
- `user_prompt_template_favorites`
- `user_prompt_template_usage`

但当前阶段不建议提前拆。

## 11. SQL 草案示意

```sql
create table prompt_templates (
  id varchar(64) primary key,
  slug varchar(128) not null unique,
  title varchar(120) not null,
  summary text not null,
  category varchar(64) not null,
  ratio varchar(16) not null,
  prompt text not null,
  negative_prompt text null,
  guidance json not null,
  tags json not null,
  template_type varchar(32) not null,
  status varchar(32) not null default 'draft',
  review_status varchar(32) not null default 'pending',
  is_featured boolean not null default false,
  sort_order int not null default 0,
  cover_style text not null,
  source_name varchar(128) null,
  source_author varchar(128) null,
  source_url text null,
  license varchar(64) null,
  import_batch varchar(64) null,
  review_note text null,
  editor_note text null,
  usage_count int not null default 0,
  favorite_count int not null default 0,
  created_at datetime not null,
  updated_at datetime not null,
  published_at datetime null
);
```

说明：

- 上面是结构草案，不绑定具体数据库方言
- 如果后端选型改为 PostgreSQL / MySQL / SQLite，再做方言落地

## 12. 推荐下一步

基于本 schema 草案，下一步建议直接接：

1. 模板后台管理 API 草案
2. 模板后台页面信息架构
3. 静态模板到服务端模板的迁移计划

## 13. 当前判断

`prompt_templates` 现在已经足够进入后端设计阶段。

不建议继续把更多官方模板长期写死在前端静态文件里，再倒回来迁移。
