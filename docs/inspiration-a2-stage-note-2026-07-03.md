# 灵感广场 A2 Stage Note

Updated: 2026-07-03
Scope: `D:\gpt_image_playground-main`

## 目标

这份说明文档用于固定当前 `A2` 包的边界。

这里的 `A2` 指：

- `灵感广场`
- `inspiration_public`
- `AI 初审`
- `运营台基础`

本说明只描述当前已经整理成 `A2-only staged set` 的内容，不覆盖 `A1 / 线路准入 / 平台能力 / 提示词库` 其他并行主线。

## 当前结论

当前 `git diff --cached` 已经收敛到 `A2-only` 候选集合。

这次整理完成了两类关键动作：

1. 共享文件拆分
   - `src/App.tsx`
   - `src/types.ts`
   - `server/migrations/001_init.sql`
   - `src/components/AdminApp.tsx`
   - `src/components/AdminApp.css`
2. 整包裁切
   - 已把明确属于 `A1 / gateway / platform / 结果解释 / 计费` 的 staged 文件从 index 中剥离

所以当前 staged 集合的含义已经不是“仓库当前所有大改动”，而是“可单独评估的灵感广场 A2 包”。

## 当前包内内容

### 文档与脚本

- `docs/inspiration-square-development-plan.md`
- `scripts/seed-inspiration-demo.mjs`
- `scripts/verify-inspiration-migration.mjs`

### 服务端能力

- `server/migrations/001_init.sql`
- `server/src/app.ts`
- `server/src/shareModeration.ts`
- `server/src/shareModeration.test.ts`
- `server/src/imageShares.ts`
- `server/src/imageShares.test.ts`
- `server/src/adminImageShares.ts`
- `server/src/adminImageShares.test.ts`
- `server/src/inspirationPosts.ts`
- `server/src/inspirationPosts.test.ts`
- `server/src/inspirationReview.ts`
- `server/src/adminInspirationPosts.ts`
- `server/src/adminInspirationPosts.test.ts`

### 前台与运营台

- `src/App.tsx`
- `src/types.ts`
- `src/components/AdminApp.tsx`
- `src/components/AdminApp.css`
- `src/components/InspirationView.tsx`
- `src/components/InspirationView.test.tsx`
- `src/components/InspirationLatestView.tsx`
- `src/components/InspirationLatestView.test.tsx`
- `src/components/InspirationTopicView.tsx`
- `src/components/InspirationTopicView.test.tsx`
- `src/components/InspirationPostView.tsx`
- `src/components/InspirationPostView.test.tsx`
- `src/components/InspirationOverlayCard.tsx`
- `src/lib/inspirationApi.ts`
- `src/lib/inspirationApi.test.ts`
- `src/lib/inspirationDisplay.ts`
- `src/lib/inspirationDisplay.test.ts`
- `src/lib/adminInspirationDisplay.ts`
- `src/lib/adminInspirationDisplay.test.ts`
- `src/lib/inspirationTopics.ts`
- `src/lib/inspirationTopics.test.ts`

## 本包明确包含的产品边界

### 公开分享分层

- `generation_output_shares` 增加 `purpose`
- 区分 `manual` 与 `inspiration_public`
- 灵感广场公开链路不再和普通手动分享混为一条线

### 分享审核态

- `review_status`
- `review_summary`
- 后台分享审计可按审核态查看

### 灵感广场公开链路

- 首页
- 最新入选
- 专题页
- 作品详情页
- 进入创作台跳转

### AI 初审与运营台基础

- `shareModeration`
- `inspirationPosts`
- `inspirationReview`
- `adminInspirationPosts`
- 后台 `inspiration` 模块、详情、动作、队列、概况卡片

## 本包明确不包含的内容

这次整理后，以下内容已不在当前 staged 包内：

- `gateway route admission`
- `2K / 4K probe`
- `platform capabilities`
- `task result display / partial charge explanation`
- `model sku / route capability` 那一整条平台能力线
- `提示词安全 / 提示词库 / prompt optimizer`

换句话说，当前这包不是平台能力发布包，也不是提示词库包。

## 共享文件拆分后的边界

### `src/App.tsx`

当前 staged 只保留：

- `灵感广场` 导航入口
- `/inspiration` 路由解析
- 首页 / 专题 / 最新 / 详情挂载
- `is-inspiration-shell`

没有把通用登录态刷新替换改成另一条主线。

### `src/types.ts`

当前 staged 只保留：

- `GalleryView = inspiration`
- `OwnerImageShare.purpose`
- `OwnerImageShare.reviewStatus`
- `OwnerImageShare.reviewSummary`
- `Inspiration*` 相关类型

没有把 `GatewayRouteProbe* / GatewayRoutePreflight* / PublicTaskResultView / chargedPoints` 一起带入。

### `server/migrations/001_init.sql`

当前 staged 只保留：

- `generation_output_shares` 的 `purpose / review_status / review_summary`
- `inspiration_posts` 及周边表
- `inspiration_public` 相关索引

没有把 `gateway_routes.compatibility_strategy / max_supported_long_edge / high_res_probe_* / is_official` 带进来。

## 已完成验证

已执行并通过：

```powershell
npx vitest run server/src/adminInspirationPosts.test.ts server/src/inspirationPosts.test.ts src/components/InspirationLatestView.test.tsx src/components/InspirationTopicView.test.tsx server/src/imageShares.test.ts server/src/adminImageShares.test.ts
```

结果：

- `6` 个测试文件通过
- `38` 个测试通过

已执行并通过：

```powershell
npm run build
```

## 当前状态判断

当前这包已经达到：

- 功能线独立
- staged 边界独立
- 最小验证通过

因此它已经具备“可作为单独 A2 包评估 / 提交说明 / 继续提交”的条件。

## 后续建议

如果下一步继续推进，优先顺序应是：

1. 基于当前 staged set 做提交说明或提交
2. 不要再回头把 `A1 / gateway / platform` 线混回这包
3. 后续新线程若继续做其他主线，应以当前 A2 包已独立为前提

## 一句话结论

当前 staged 集合已经不是“灵感广场相关改动散落在脏仓库里”，而是“一份边界明确、验证通过的 A2-only 候选包”。
