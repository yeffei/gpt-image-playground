# 对象存储接入方案

更新时间：2026-07-04  
适用范围：`D:\gpt_image_playground-main`

## 1. 当前目标

把当前服务端本地磁盘图片存储，升级为一套可切换的对象存储抽象，优先支持 `S3 兼容协议`，并保持：

- 前台图片 URL 契约尽量不变
- `generation_task_outputs.storage_provider + storage_key` 继续作为底层真相
- 回收站、分享、灵感广场、后台查询不因为存储后端切换而失效

这份文档只定架构和落地顺序，当前不直接改实现代码。

## 2. 当前实现现状

当前主链路是本地磁盘模式：

1. `server/src/imageGateway.ts`
   - `persistGeneratedOutputs()` 调用 `storeGeneratedImage()`
2. `server/src/imageStorage.ts`
   - 把图片写到 `SERVER_IMAGE_STORAGE_DIR`
   - 返回：
     - `storageProvider: 'local'`
     - `storageKey: {taskId}/{outputIndex}.jpg|png|webp`
     - `publicUrl: /api/generated-images/:taskId/:filename`
3. `server/src/app.ts`
   - `GET /api/generated-images/:taskId/:filename` 直接从本地文件系统读图
4. `generation_task_outputs`
   - 保存 `storage_provider / storage_key / public_url / mime_type / byte_size / width / height`

当前还依赖本地文件系统的地方，不止上传：

- `server/src/app.ts`
  - 正常图片展示读取本地文件
- `server/src/imageShares.ts`
  - 分享受控读取 `storage_key` 对应本地文件
- `server/src/inspirationPosts.ts`
  - 尺寸缺失时，从本地文件回读图片字节补 `width / height`
- `server/src/trashedOutputCleanup.ts`
  - 回收站到期时直接 `rm()` 本地文件

所以这不是“加一个 S3 上传”就结束的事情，必须把“写 / 读 / 删 / 受控读”一起抽象。

## 3. 推荐结论

### 3.1 存储策略

推荐改为：

- 统一引入 `S3 兼容对象存储抽象`
- 首版继续保留 `local` 适配器
- 新增 `s3` 适配器
- 运行时通过环境变量切换当前写入后端

推荐理由：

- `R2 / OSS / MinIO / AWS S3` 都能走同一套协议
- 不把代码绑死到某一家云厂商
- 本地开发还能继续用 `local`，不会强迫每个人先起云存储

### 3.2 URL 策略

首版推荐保持前台 URL 契约不变：

- 继续由后端提供 `/api/generated-images/:taskId/:filename`
- 后端按 `storage_provider + storage_key` 去真实存储读取

不建议第一步就把 `public_url` 改成对象存储直链，原因：

- 前端和测试里已经大量依赖 `/api/generated-images/...`
- 分享、权限控制、未来防盗链更适合先由后端掌握
- 先保证“换后端不换前台协议”，迁移风险最小

也就是说：

- `public_url` 首版仍可保持 `/api/generated-images/...`
- 但这条 URL 背后不再默认读本地盘，而是走统一存储读取层

后续如果要上 CDN 直链，可以作为二期能力单独做。

### 3.3 推荐接入方式

推荐默认路线：

- 抽象层按 `S3-compatible first`
- 本地开发默认仍用 `local`
- 生产优先接 `Cloudflare R2` 或正式 `S3`
- 如果你希望本地就模拟对象存储，开发环境再加 `MinIO`

## 4. 建议的模块设计

建议新增 `server/src/objectStorage.ts`，把所有底层读写收口到一个接口。

### 4.1 接口建议

```ts
type ObjectStorageProvider = 'local' | 's3'

type StoredObjectDescriptor = {
  storageProvider: ObjectStorageProvider
  storageKey: string
  publicUrl: string
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
}

interface GeneratedImageStorage {
  putGeneratedImage(input: {
    taskId: string
    outputIndex: number
    dataUrl: string
  }): Promise<StoredObjectDescriptor>

  openReadStream(input: {
    storageProvider: ObjectStorageProvider
    storageKey: string
  }): Promise<{
    stream: NodeJS.ReadableStream
    mimeType?: string
  }>

  deleteObject(input: {
    storageProvider: ObjectStorageProvider
    storageKey: string
  }): Promise<void>

  readObjectBytes?(input: {
    storageProvider: ObjectStorageProvider
    storageKey: string
  }): Promise<Buffer>
}
```

### 4.2 适配器建议

- `server/src/objectStorage/localObjectStorage.ts`
- `server/src/objectStorage/s3ObjectStorage.ts`
- `server/src/objectStorage/index.ts`

职责划分：

- `local`
  - 兼容现在的写盘 / 读盘 / 删盘逻辑
- `s3`
  - 负责 `PutObject / GetObject / DeleteObject`
  - 不把业务代码暴露给具体 SDK

### 4.3 业务层改造点

首版至少改这 4 处：

1. `server/src/imageStorage.ts`
   - 改为统一委托到对象存储抽象
2. `server/src/app.ts`
   - `/api/generated-images/...` 不再直读本地盘，改为按数据库或规则反查 `storage_key` 后统一读取
3. `server/src/imageShares.ts`
   - 分享受控读取改走统一存储读取
4. `server/src/trashedOutputCleanup.ts`
   - 物理清理改走统一删除接口，不再直接 `rm()`

补充改造：

5. `server/src/inspirationPosts.ts`
   - 尺寸缺失回补时，从统一存储读取字节，而不是假设本地文件

## 5. 数据库策略

数据库层不建议新加主表字段。

原因：

- `storage_provider`
- `storage_key`
- `public_url`

这 3 个字段已经足够支撑迁移。

首版只需要扩展语义：

- `storage_provider = 'local'` 表示旧文件或本地开发
- `storage_provider = 's3'` 表示对象存储

如果后面需要更细粒度，再考虑：

- `storage_bucket`
- `storage_region`
- `storage_version_id`

但当前不建议先把模型复杂化。

## 6. 环境变量建议

建议新增：

```env
OBJECT_STORAGE_PROVIDER=local

S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
S3_KEY_PREFIX=generated-images/
```

说明：

- `OBJECT_STORAGE_PROVIDER`
  - `local | s3`
- `S3_ENDPOINT`
  - 用于 `R2 / MinIO / 兼容网关`
- `S3_FORCE_PATH_STYLE`
  - `MinIO` 常常需要
- `S3_KEY_PREFIX`
  - 用于多环境隔离，如 `prod/generated-images/`

当前 `SERVER_IMAGE_PUBLIC_BASE_PATH` 建议保留。

因为首版仍然通过后端路由对外暴露图片，不需要让前台知道对象存储直链。

## 7. 迁移路径

推荐按 4 个阶段走。

### Phase 1：抽象层落地，但行为不变

目标：

- 引入对象存储接口
- 先只实现 `local` 适配器
- 业务代码全部改为走抽象层

结果：

- 线上行为不变
- 但业务代码不再绑死本地磁盘

### Phase 2：接入 `s3` 适配器

目标：

- 新增 `s3` 实现
- 在测试 / 开发环境验证上传、读取、删除

结果：

- 新生成图片可直接写入对象存储
- 读取和回收站逻辑都能走通

### Phase 3：切换新写入

目标：

- 生产把 `OBJECT_STORAGE_PROVIDER` 从 `local` 切到 `s3`
- 新产出的作品都写对象存储

结果：

- 老数据仍是 `local`
- 新数据已是 `s3`
- 系统进入双读期

### Phase 4：历史数据迁移

目标：

- 写一个一次性迁移脚本
- 把旧 `local` 文件上传到对象存储
- 更新 `generation_task_outputs.storage_provider / storage_key`

结果：

- 完成后才考虑停止本地历史盘依赖

## 8. 回滚策略

必须保留简单回滚。

推荐回滚方式：

- 新写入切换前，先保留 `local` 适配器
- 如果 `s3` 出问题，直接把 `OBJECT_STORAGE_PROVIDER` 切回 `local`
- 双读阶段不删除旧本地文件
- 历史迁移脚本必须支持 dry-run

不要在刚切换 `s3` 的同一天就删本地旧文件。

## 9. 测试建议

最少补这几类：

1. 上传后返回 `storage_provider = 's3'`
2. `/api/generated-images/...` 能从对象存储读图
3. 分享受控读取能从对象存储读图
4. 回收站清理能删除对象存储对象
5. `local + s3` 混合数据时，作品库 / 分享 / 回收站都正常

本地测试建议：

- 单元测试用 mock client
- 集成测试二选一：
  - 先 mock `s3` SDK
  - 后续再补 `MinIO` 集成测试

## 10. 当前推荐决策

如果现在就开始做，我建议按下面这套定：

1. 首版目标：不是“上 CDN”，而是“把存储后端从本地盘抽象出来”
2. 首版 URL：继续保持 `/api/generated-images/...`
3. 首版协议：按 `S3-compatible` 设计，不绑定某一家
4. 首版部署：生产接 `R2` 或 `S3`，本地继续 `local`
5. 首版迁移：先支持新写入切换，不立刻搬历史文件

## 11. 需要你确认的唯一关键选型

我建议你在下面两种路线里选一个：

### 方案 A：`S3-compatible` 通用抽象，生产先接 `R2`

优点：

- 代码最通用
- 后面切 `S3 / OSS / MinIO` 不需要重写业务层
- 最适合平台长期演进

缺点：

- 首次接入时环境变量会稍微多一点

### 方案 B：直接按某一家云厂商 SDK 深绑

优点：

- 首次接入可能更快一点

缺点：

- 后续迁移成本更高
- 代码会更早和供应商耦合

推荐：`方案 A`
