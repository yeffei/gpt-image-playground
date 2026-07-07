# 灵感广场开发方案

更新时间：2026-07-02

适用范围：`D:\gpt_image_playground-main`

## 1. 产品定位

`灵感广场` 是现有安全结果分享能力之上的公开展示与内容沉淀模块，不是重社区。

第一版目标是：让用户可以把高质量成品发布到站内公开展示区，同时通过 AI 自动初审和后台抽查控制广场质量，形成平台的作品门面与回流入口。

当前已确认的产品口径：

- 定位为 `编辑精选型展示层`，不是点赞、评论、关注、私信式社区。
- 首页气质偏 `编辑精选`，优先展示精选内容，再展示最新入选。
- 作者存在感默认保持 `轻作者`，当前公开前台以昵称快照和作品为主；作者主页、关注、收藏夹等能力如继续承接前期沉淀，应作为弱入口扩展，而不是把广场主路径做成重社区。
- 奖励机制不作为当前公开前台主路径必需项；如继续承接前期能力，需以后续真实浏览、发布和转化数据来决定是否放大。
- 不展示完整提示词，不展示负面词，不暴露模型线路细节。

## 2. V1 核心范围

### 2.1 发布门槛

灵感广场不是“所有可分享图片”的公开流，必须先做硬门槛过滤。

V1 发布资格固定为：

- 仅允许服务端持久化输出发布，即必须存在 `generation_task_outputs` 记录。
- 以服务端 `generation_task_outputs.width / height` 为唯一权威尺寸来源。
- 最终交付文件长边必须 `>= 2048`，即 `1K` 作品不能发布。
- 分享内容审核必须为 `auto_pass`。
- 输出文件必须可公开读取。
- 成品宽高比不能是明显异常比例，建议第一版只拦截 `< 0.5` 或 `> 2.4` 的极端比例。

说明：

- 不使用过窄固定比例白名单，避免误伤现有 `3:2 / 4:3 / 21:9 / 自定义比例` 等合法尺寸能力。
- 前端本地读到的实际尺寸只用于提前提示，最终准入以后端判断为准。
- 宽高缺失时拒绝发布，提示 `当前作品缺少服务端尺寸信息，暂不支持发布到灵感广场`。

### 2.2 分享层分离

现有 `/share/:token` 是私链分享能力，灵感广场需要独立公开发布语义，不能直接和普通分享混用。

V1 数据设计必须区分分享用途：

- 为 `generation_output_shares` 增加 `purpose` 字段。
- `purpose = manual`：用户手动创建的私链分享。
- `purpose = inspiration_public`：灵感广场自动创建的公开分享。

交互规则：

- 结果详情里的“创建分享链接”只读写 `manual` 分享。
- 灵感广场发布时如缺少可用公开分享，则自动创建 `inspiration_public` 分享。
- 用户私链分享可以设置访问码和过期时间。
- 灵感广场专用分享不设置访问码、不设置过期时间。
- 分享审计页默认继续关注 `manual` 分享，灵感广场走独立运营台。

这样可以避免广场自动创建的公开分享覆盖用户原本的私密分享设置。

### 2.3 灵感广场帖子

新增独立表 `inspiration_posts`，承载广场发布层，不把广场字段直接塞进普通分享表。

建议字段：

- `id`
- `share_id`
- `output_id`
- `user_id`
- `author_name_snapshot`
- `category`
- `title`
- `caption`
- `processing_label`
- `status`
- `featured`
- `featured_rank`
- `published_at`
- `featured_at`
- `created_at`
- `updated_at`
- `ai_review_status`
- `ai_review_result`

状态建议：

- `ai_reviewing`：AI 初审中，前台暂不展示。
- `published`：公开展示。
- `needs_review`：需人工抽查，前台暂不展示。
- `hidden`：已隐藏，可恢复。
- `removed`：用户撤回或管理员移除，不再恢复为同一条公开记录。

约束：

- 同一个 `output_id` 同时最多只有一条未移除的广场记录。
- 重复发布同一输出时返回现有帖子，不重复创建。
- 用户撤回发布时，将帖子置为 `removed`，并撤销关联的 `inspiration_public` 分享。

### 2.4 数据约束补充

为避免后续实现时再返工，V1 先把几条关键数据边界锁定：

- `generation_output_shares.purpose` 必填，默认值为 `manual`。
- 同一 `output_id` 允许存在多条 `manual` 分享，但同一时刻最多只允许一条有效 `inspiration_public` 分享。
- `inspiration_posts.share_id` 必须指向 `purpose = inspiration_public` 的分享记录。
- `inspiration_posts.output_id`、`user_id` 必须和关联分享保持一致，不允许跨输出复用帖子。
- `author_name_snapshot` 在发布时写入，后续用户改昵称不回刷历史帖子。
- `category` 第一版必须落在现有提示词库的 8 个大类内，后台允许修正，前台不开放自定义。
- `processing_label` 使用用户可理解口径，例如 `文生图`、`图像编辑`、`局部重绘`，不直接暴露底层模型或线路 ID。
- `ai_review_result` 允许为空，仅在 AI 已返回结果时写入结构化 JSON。

## 3. AI 广场审核台

后台不做传统人工逐条审核列表，而是做 `AI 自动初审 + 人工抽查`。

### 3.1 AI 初审流程

用户点击 `发布到灵感广场` 后：

1. 服务端先校验硬门槛：`2K+ / auto_pass / 非极端比例 / 文件可读`。
2. 通过后创建或复用 `inspiration_public` 分享。
3. 创建 `inspiration_posts`，状态为 `ai_reviewing`。
4. 后台异步调用 AI 质检。
5. AI 生成分流结果、质量评分、风险评分、精选建议、分类修正建议和内部备注。
6. 系统根据 AI 决策自动分流，后台只处理重点队列。

### 3.2 AI 决策类型

AI 初审输出固定为以下几类：

- `publish`：可公开，进入最新入选。
- `recommend_featured`：可公开，并进入后台 AI 推荐精选队列。
- `needs_review`：暂不公开，进入人工抽查队列。
- `auto_hidden`：自动隐藏，后台可恢复。
- `reject`：不适合公开发布。

权限边界：

- AI 可以自动公开普通合格作品。
- AI 可以自动隐藏明显不适合的作品。
- AI 可以推荐精选。
- AI 可以基于评分、尺寸和互动信号参与首页精选位自动编排，但人工操作必须始终可以覆盖。
- AI 不永久删除内容。
- 人工操作永远可以覆盖 AI 判断。

### 3.3 状态流转

为了避免前后台和异步任务各自理解不同，第一版状态流转固定如下：

- 用户点击发布：
  - 资格校验失败：不创建帖子，直接返回失败原因。
  - 资格校验成功：创建或复用 `inspiration_public` 分享，创建 `ai_reviewing` 帖子。
- AI 返回 `publish`：
  - 帖子状态改为 `published`
  - `featured = false`
  - 出现在“最新入选”
- AI 返回 `recommend_featured`：
  - 帖子状态改为 `published`
  - 进入后台 `AI 推荐精选` 队列
  - 系统可继续基于评分、分辨率和互动信号自动分配首页精选位，后台也可覆盖调整
- AI 返回 `needs_review`：
  - 帖子状态改为 `needs_review`
  - 前台不展示
- AI 返回 `auto_hidden` 或 `reject`：
  - 帖子状态改为 `hidden`
  - 前台不展示
  - 后台可恢复或改判
- 用户撤回发布：
  - 帖子状态改为 `removed`
  - 关联 `inspiration_public` 分享失效
  - 后台不再将其视为可恢复公开记录
- 管理员隐藏：
  - 已发布帖子改为 `hidden`
- 管理员恢复：
  - `hidden` 或 `needs_review` 可恢复为 `published`

说明：

- `reject` 先落到 `hidden` 展示语义，不单独做一个前台可见状态。
- `removed` 只表示用户或平台撤回该次公开发布，不影响原始输出和私链分享。
- `featured` 是展示位标签，不替代 `status`。

### 3.4 AI 质检结果结构

`ai_review_result` 建议保存结构化 JSON，内部使用，不对普通用户公开。

建议结构：

```json
{
  "decision": "recommend_featured",
  "qualityScore": 86,
  "riskScore": 12,
  "displayFit": "secondary_featured",
  "categorySuggestion": "品牌广告",
  "strengths": ["主体清晰", "商业质感强", "色彩统一"],
  "risks": ["局部文字可能不稳定"],
  "internalNote": "适合作为品牌广告分类的次级精选，画面完整度较高。",
  "reviewedAt": "2026-06-28T00:00:00.000Z"
}
```

后台显示重点：

- 综合质量分
- 风险分
- 适合展示位
- 优点
- 风险
- 推荐分类修正
- 精选理由
- AI 内部备注

## 4. 前台体验

### 4.1 入口

新增前台入口：

- 导航项：`灵感广场`
- 首页路由：`/inspiration`
- 详情路由：`/inspiration/:postId`

发布入口只放在结果详情弹层，不在作品卡列表铺太多按钮。

### 4.2 首页结构

首页采用编辑精选结构：

- 顶部标题区：`SST 创作工作台 · 灵感广场`
- 精选区：`1 张主视觉 + 3 张次级精选`
- 分类筛选条：复用现有提示词库 8 个大类
- 最新入选网格

首页默认先展示精选，再展示最新入选。

### 4.3 作品卡片与详情页

卡片展示：

- 图片
- 标题或短说明
- 分类
- 处理方式
- 轻作者昵称
- 发布时间

详情页展示：

- 大图
- 标题或短说明
- 分类
- 处理方式
- 轻作者昵称
- 发布时间
- 相关作品
- `进入网站继续创作` 入口

不展示：

- 完整提示词
- 负面词
- 线路 ID
- 上游模型
- 质量分
- AI 审核理由

### 4.4 用户侧状态文案

用户侧文案保持简单，不暴露复杂审核细节：

- 发布成功：`已发布到灵感广场`
- 初审中：`正在进行发布检查，稍后会自动展示`
- 尺寸不足：`仅支持发布 2K 及以上作品`
- 不适合公开：`该作品暂不适合公开展示`
- 尺寸缺失：`当前作品缺少服务端尺寸信息，暂不支持发布到灵感广场`

## 5. 后台运营台

后台模块建议命名为 `灵感广场运营台` 或 `广场 AI 审核台`。

核心队列：

- `AI 推荐精选`
- `需人工抽查`
- `已自动隐藏`
- `最新入选`

后台操作保持少：

- 设为精选
- 取消精选
- 隐藏
- 恢复公开
- 修改分类
- 查看 AI 理由

后台不需要逐条人工写质量备注，质量备注由 AI 生成。

后台列表建议字段：

- 缩略图
- 标题
- 分类
- 作者
- 处理方式
- 发布尺寸
- AI 决策
- 质量分
- 风险分
- 当前状态
- 发布时间

## 6. API 草案

用户侧接口：

- `GET /api/image/outputs/:outputId/inspiration-eligibility`
- `POST /api/image/outputs/:outputId/inspiration-post`
- `DELETE /api/inspiration/posts/:id`
- `GET /api/inspiration/home`
- `GET /api/inspiration/posts`
- `GET /api/inspiration/posts/:id`

后台接口：

- `GET /api/admin/inspiration-posts`
- `GET /api/admin/inspiration-posts/:id`
- `PATCH /api/admin/inspiration-posts/:id`
- `POST /api/admin/inspiration-posts/:id/review-ai`
- `POST /api/admin/inspiration-posts/:id/feature`
- `DELETE /api/admin/inspiration-posts/:id/feature`

现有分享接口调整：

- `GET /api/image/outputs/:outputId/shares` 默认只返回 `purpose = manual`。
- `POST /api/image/outputs/:outputId/shares` 默认只创建 `purpose = manual`。
- 公开分享 `/api/shares/:token` 继续保留，服务私链分享和广场图片读取底层能力。

发布资格接口返回建议：

```json
{
  "eligible": true,
  "reason": "ok",
  "width": 2560,
  "height": 1440,
  "longEdge": 2560
}
```

失败原因建议：

- `size_too_small`
- `size_unavailable`
- `review_not_passed`
- `ratio_out_of_range`
- `content_unavailable`

### 6.1 发布资格接口契约

`GET /api/image/outputs/:outputId/inspiration-eligibility`

用途：

- 结果详情弹层打开时查询是否可发布。
- 仅返回当前输出是否满足硬门槛，不创建任何分享或帖子。

建议返回：

```json
{
  "eligible": false,
  "reason": "size_too_small",
  "width": 1024,
  "height": 1024,
  "longEdge": 1024,
  "existingPost": null
}
```

补充约定：

- 若该输出已有未移除帖子，则 `eligible = true`，同时返回 `existingPost`，前端展示“已发布/审核中/已隐藏”等当前状态，而不是继续显示发布按钮。
- `reason = ok` 时允许调用发布接口。
- 若 `reason = review_not_passed`，表示现有分享审核链路不是 `auto_pass`，仍可继续私链分享，但不可发广场。

`existingPost` 建议结构：

```json
{
  "id": "post_xxx",
  "status": "published",
  "featured": false,
  "publishedAt": "2026-06-30T03:00:00.000Z"
}
```

### 6.2 创建发布接口契约

`POST /api/image/outputs/:outputId/inspiration-post`

请求体建议：

```json
{
  "title": "玻璃器皿产品海报",
  "caption": "冷白棚拍质感，强调透明材质与反光控制。",
  "category": "产品静物",
  "processingLabel": "文生图"
}
```

服务端行为：

1. 再次执行资格校验，不能信任前端预检结果。
2. 查找当前输出是否已有未移除帖子。
3. 如无，则创建或复用 `purpose = inspiration_public` 分享。
4. 创建帖子并进入 `ai_reviewing`。
5. 投递 AI 初审任务。

成功返回建议：

```json
{
  "post": {
    "id": "post_xxx",
    "status": "ai_reviewing",
    "featured": false,
    "title": "玻璃器皿产品海报",
    "category": "产品静物",
    "processingLabel": "文生图",
    "publishedAt": null
  },
  "shareToken": "public_xxx"
}
```

幂等规则：

- 同一 `outputId` 存在 `ai_reviewing / published / needs_review / hidden` 任一帖子时，直接返回现有帖子，不重复创建。
- 只有 `removed` 后，才允许再次创建一条新的公开发布记录。

### 6.3 撤回发布接口契约

`DELETE /api/inspiration/posts/:id`

约束：

- 仅帖子所属用户或管理员可调用。
- `published / ai_reviewing / needs_review / hidden` 都允许撤回。
- 撤回后返回最新帖子状态 `removed`。

建议返回：

```json
{
  "success": true,
  "post": {
    "id": "post_xxx",
    "status": "removed"
  }
}
```

### 6.4 首页与列表接口契约

`GET /api/inspiration/home`

建议按首页结构直接返回，避免前端再做二次拼装：

```json
{
  "heroFeatured": {
    "id": "post_main",
    "title": "夏季品牌主视觉",
    "category": "品牌广告"
  },
  "secondaryFeatured": [
    { "id": "post_a", "title": "金属耳机产品广告", "category": "产品静物" },
    { "id": "post_b", "title": "概念茶饮海报", "category": "海报插画" },
    { "id": "post_c", "title": "零售空间夜景", "category": "空间氛围" }
  ],
  "latest": [],
  "categories": [
    "海报插画",
    "人像摄影",
    "产品静物",
    "空间氛围",
    "品牌广告",
    "UI / 社媒视觉",
    "角色设定",
    "信息图解"
  ]
}
```

`GET /api/inspiration/posts`

查询参数建议：

- `category`
- `cursor`
- `limit`
- `sort=latest`

第一版只开放 `published` 帖子，不把 `featured` 独立成第二套列表接口。

`GET /api/inspiration/posts/:id`

建议返回：

- 当前帖子公开字段
- 关联公开图片地址
- 最多 6 条相关作品
- `enterStudioUrl`，统一跳回站内创作入口

### 6.5 后台接口契约

`GET /api/admin/inspiration-posts`

查询参数建议：

- `queue=featured_candidates | needs_review | auto_hidden | latest`
- `category`
- `cursor`
- `limit`

队列映射建议：

- `featured_candidates`：`status = published` 且 AI `decision = recommend_featured`
- `needs_review`：`status = needs_review`
- `auto_hidden`：`status = hidden` 且 AI `decision in (auto_hidden, reject)`
- `latest`：`status = published`

`PATCH /api/admin/inspiration-posts/:id`

建议仅支持以下变更：

- `status`
- `category`
- `title`
- `caption`

`POST /api/admin/inspiration-posts/:id/feature`

请求体建议：

```json
{
  "slot": "hero",
  "rank": 1
}
```

约定：

- `slot = hero | secondary`
- 首页主精选同一时刻仅允许 1 条
- 次级精选同一时刻最多 3 条

`DELETE /api/admin/inspiration-posts/:id/feature`

- 只清除 `featured` 与 `featured_rank`
- 不改变帖子 `published` 状态

## 7. 实施计划

实施节奏按 `先打通发布闭环，再接 AI 分流，再做运营增强` 推进，避免一开始就把广场做成重后台系统。

### 7.1 V1 实施顺序

1. 数据库迁移：为 `generation_output_shares` 增加 `purpose`，新增 `inspiration_posts` 表。
2. 服务端发布资格：实现 `2K+ / auto_pass / 非极端比例 / 文件可读` 校验，并返回明确失败原因。
3. 分享用途分层：保证 `manual` 分享继续服务私链，`inspiration_public` 只服务灵感广场。
4. 发布接口：实现创建、重复发布返回现有帖子、用户撤回发布。
5. 前台发布入口：在结果详情弹层加入 `发布到灵感广场`，并显示尺寸不足、初审中、发布成功等状态。
6. 前台公开页：实现 `/inspiration` 首页和 `/inspiration/:postId` 详情页。
7. 后台基础运营台：实现最新入选、隐藏、恢复、设为精选、取消精选。
8. 回归验证：确认现有 `/share/:token`、手动分享和分享审计不受影响。

### 7.2 实现拆分建议

为避免多人并行时互相踩文件，建议按以下 4 条工作流拆分：

1. 数据与迁移流
   - 增加 `generation_output_shares.purpose`
   - 新增 `inspiration_posts`
   - 补唯一约束、索引、回滚策略
2. 服务端发布闭环流
   - 发布资格查询
   - 发布创建/幂等/撤回
   - `manual` 与 `inspiration_public` 分层
3. 前台体验流
   - 结果详情弹层发布面板
   - `/inspiration` 首页
   - `/inspiration/:postId` 详情页
4. 后台运营流
   - 队列列表
   - 设为精选/取消精选
   - 隐藏/恢复
   - AI 理由查看

并行原则：

- 1 完成前，2 只做接口骨架，不落最终 SQL 依赖。
- 2 的响应结构先锁定后，3 再接前端，避免接口名反复改。
- 4 依赖 2 的后台查询结构，但不依赖 AI 真正接入，可先用假数据字段占位。

### 7.3 建议的实际开工顺序

如果下一轮确认进入实现，建议按下面顺序推进，而不是先画页面壳子：

1. 数据库迁移与服务端类型定义
2. 发布资格接口
3. 发布/撤回接口
4. 调整现有分享接口默认只处理 `manual`
5. 前台结果详情发布面板
6. `/inspiration` 首页与详情页
7. 后台基础运营台
8. AI 异步任务接入

这样可以先把最容易影响旧分享链路的地方锁住，再做页面接线。

### 7.4 服务端任务拆分

服务端建议按“迁移、领域逻辑、路由接线、回归保护”四层拆：

1. 数据库迁移
   - 为 `generation_output_shares` 增加 `purpose`
   - 为历史数据回填 `manual`
   - 为 `purpose = inspiration_public` 增加唯一性约束策略
   - 新建 `inspiration_posts`
   - 为 `status`、`featured`、`category`、`published_at` 建索引
2. 类型与模型层
   - 增加 `SharePurpose`
   - 增加 `InspirationPostStatus`
   - 增加 `AiReviewDecision`
   - 增加 `InspirationEligibilityReason`
   - 统一前后端共享的响应类型定义
3. 发布资格服务
   - 读取服务端权威尺寸
   - 校验 `auto_pass`
   - 校验极端比例
   - 校验输出文件是否可公开读取
   - 查找该输出是否已有未移除帖子
4. 分享分层服务
   - 调整现有查询默认只返回 `manual`
   - 增加按 `purpose` 精确查询的内部方法
   - 增加创建或复用 `inspiration_public` 分享方法
   - 增加撤销广场公开分享方法
5. 灵感广场帖子服务
   - 创建帖子
   - 重复发布幂等返回
   - 查询首页精选与最新入选
   - 查询详情与相关作品
   - 用户撤回发布
   - 后台隐藏/恢复/精选/改分类
6. 路由接线
   - 用户侧发布资格接口
   - 用户侧发布与撤回接口
   - 前台首页、列表、详情接口
   - 后台队列与操作接口
7. 回归保护
   - 手动分享默认行为不变
   - 分享审计默认只看 `manual`
   - 公共读取 `/api/shares/:token` 保持兼容

### 7.5 前台任务拆分

前台建议按“结果详情发布面板”和“广场展示页”两条线分开：

1. 结果详情发布面板
   - 弹层打开时请求发布资格
   - 根据 `eligible / reason / existingPost` 显示不同态
   - 可发布时展示标题、分类、处理方式、短说明表单
   - 提交后进入 `ai_reviewing` 状态提示
   - 已有帖子时显示当前状态与撤回入口
2. 文案与状态展示
   - `size_too_small`
   - `size_unavailable`
   - `review_not_passed`
   - `ratio_out_of_range`
   - `content_unavailable`
   - `ai_reviewing / published / needs_review / hidden / removed`
3. 灵感广场首页
   - 顶部标题区
   - 主精选卡
   - 3 张次级精选
   - 分类筛选条
   - 最新入选网格
4. 灵感作品详情页
   - 主图
   - 轻信息区
   - 相关推荐
   - 进入网站继续创作入口
5. 导航接入
   - 前台主导航新增 `灵感广场`
   - 不新增冗余次入口

### 7.6 后台运营台任务拆分

后台第一版不做复杂工作流，只做高价值、低操作成本能力：

1. 队列页
   - `AI 推荐精选`
   - `需人工抽查`
   - `已自动隐藏`
   - `最新入选`
2. 列表字段
   - 缩略图
   - 标题
   - 分类
   - 作者昵称快照
   - 处理方式
   - 服务端尺寸
   - AI 决策
   - 质量分
   - 风险分
   - 当前状态
   - 发布时间
3. 操作面板
   - 设为主精选 / 次级精选
   - 取消精选
   - 隐藏
   - 恢复公开
   - 修改分类
   - 查看 AI 理由
4. 第一版明确不做
   - 批量操作
   - 自定义审核流转
   - 人工写长备注
   - 审核员分配机制

### 7.7 AI 任务拆分

AI 能力接入时建议独立为异步任务，不要塞进用户同步请求：

1. 任务触发
   - 用户成功创建帖子后异步投递
2. 输入材料
   - 公共图片可读地址
   - 用户提交的分类、标题、短说明
   - 服务端尺寸与处理方式
3. 输出结构
   - `decision`
   - `qualityScore`
   - `riskScore`
   - `displayFit`
   - `categorySuggestion`
   - `strengths`
   - `risks`
   - `internalNote`
4. 回写动作
   - 写入 `ai_review_status`
   - 写入 `ai_review_result`
   - 更新帖子 `status`
   - 记录 `published_at / featured_at` 等时间
5. 容错要求
   - AI 超时或失败时，不自动公开
   - 失败帖子回到 `needs_review` 或保留 `ai_reviewing` 待重试，避免静默丢单
   - AI 重跑不重复创建帖子和分享

### 7.8 并行协作建议

如果进入多人并行或多 worktree 推进，建议这样切：

1. `worktree-A`：数据库迁移 + 服务端发布资格 + 分享分层
2. `worktree-B`：前台结果详情发布面板 + `/inspiration` 首页
3. `worktree-C`：后台运营台基础队列
4. `worktree-D`：AI 审核任务与后台 AI 理由展示

依赖关系：

- `A` 先锁响应类型和字段名，再让 `B/C/D` 接口对接。
- `B` 可以先用 mock 响应接页面，但提交前必须切回真实契约。
- `C` 不必等待 AI 真实接入，可先按占位字段落结构。
- `D` 最后并入，避免前期异步链路放大排查成本。

### V1：高质量公开展示闭环

- 新增 `purpose` 区分私链分享和广场公开分享。
- 新增 `inspiration_posts` 数据表。
- 实现 2K 起发、`auto_pass`、非极端比例和文件可读校验。
- 实现发布入口、发布资格提示和用户撤回。
- 实现 `/inspiration` 首页与 `/inspiration/:postId` 详情页。
- 实现后台基础运营台：最新入选、隐藏、恢复、精选管理。

### V1.5：AI 自动初审与运营增强

- 接入 AI 质检任务。
- 保存 `ai_review_result`。
- 实现 AI 自动分流：公开、推荐精选、需抽查、自动隐藏、拒绝。
- 后台增加 AI 推荐精选、需人工抽查、已自动隐藏队列。
- 增加基础数据统计：浏览量、进入网站点击、详情打开、发布成功率、AI 隐藏率。

### V2：内容资产与转化增强

- 精选专题，例如 `本周商业海报精选`、`产品静物灵感`。
- 作者公开作品集，但不急着做关注、私信和评论。
- 用户收藏灵感作品到个人灵感夹。
- 一键复用风格方向，但不公开原提示词。
- 活动专题与运营 campaign。
- 是否引入奖励机制，等真实数据后再判断。

## 8. 验证重点

服务端测试：

- `1K` 作品发布失败。
- 服务端宽高缺失时发布失败。
- `2K+` 且 `auto_pass` 可进入 AI 初审。
- `attention` 可私链分享但不可发布广场。
- 极端比例发布失败。
- `manual` 分享不被广场发布覆盖。
- `inspiration_public` 分享不出现在结果详情私链列表。
- AI 分流后状态更新正确。
- 用户撤回会移除公开帖子并撤销广场专用分享。

前端测试：

- 结果详情对不符合条件的作品显示正确文案。
- 合规作品可以提交发布。
- 灵感广场首页展示精选和最新入选。
- 详情页展示轻作者、处理方式和相关作品。
- 后台队列按 AI 决策正确分组。

回归测试：

- 现有 `/share/:token` 私链页不受影响。
- 现有手动创建分享、撤销分享流程不受影响。
- 现有分享审计不被广场专用分享污染。

### 8.1 高风险回归点

实现时最需要重点防回归的是现有分享系统，而不是广场页面本身：

1. 结果详情里的“分享链接列表”不能混入 `inspiration_public`
2. 现有手动分享撤销时，不能误删广场公开分享
3. 用户撤回广场发布时，不能影响已有 `manual` 私链
4. `/api/shares/:token` 必须同时兼容私链分享和广场底层公开读取
5. 后台分享审计列表不能被广场专用分享刷屏
6. 相同输出重复发布时，不能生成多条并发公开帖子

### 8.2 建议的验收顺序

不要一上来就做全链路大验收，按下面顺序更容易定位问题：

1. 先验服务端资格判断是否准确
2. 再验 `manual` 与 `inspiration_public` 是否彻底分层
3. 再验发布/撤回幂等性
4. 再验首页与详情页公开展示
5. 最后验后台运营台和 AI 分流

### 8.3 上线前检查清单

上线前至少确认以下项目：

1. 历史 `generation_output_shares` 已正确回填 `manual`
2. `inspiration_public` 唯一约束不会误伤旧数据
3. 没有把完整提示词、负面词、模型线路暴露到公开接口
4. 用户昵称快照写入逻辑可用
5. 用户删除/撤回后公开页面不可继续访问该帖子
6. 首页精选位数量与排序规则稳定
7. AI 失败时不会卡死在不可见状态且无后台入口

## 9. 当前边界与非主路径

- 点赞、评论、关注、公开作者主页、奖励机制不再作为“硬性禁止项”单独锁死；如果继续承接前期已做能力，应降为弱入口或后续扩展，不把灵感广场主路径做成重社区。
- 私信仍不作为当前灵感广场主线能力。
- 不展示完整提示词。
- AI 可以参与首页精选自动编排，但必须允许人工覆盖，不做不可干预的黑盒精选。
- 不让 AI 永久删除内容。
