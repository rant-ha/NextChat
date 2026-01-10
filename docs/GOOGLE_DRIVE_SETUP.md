# Google Drive 自动备份配置（Arena 评测数据）

本项目的 Arena 评测数据会以 JSON 形式上传到一个 **Webhook URL**。
为了把数据真正“落到你的 Google Drive”，推荐使用 **Google Apps Script（GAS）** 作为接收端。

> 说明：
> - NextChat 作为前端应用，默认不直接集成 Google Drive OAuth。
> - 采用 GAS Web App 的方式，可以让数据写入 **你自己的 Drive**，无需在 NextChat 内配置 OAuth。

---

## 1) 在 Google Apps Script 创建接收端

1. 打开： https://script.google.com/
2. 新建项目（New project）
3. 将下面代码粘贴到 `Code.gs`

```javascript
/**
 * Arena 评测数据备份接收端（保存到 Google Drive）
 * 
 * NextChat 会 POST JSON：
 * {
 *   testerId: string,
 *   backupTime: number,
 *   periodStart: number,
 *   periodEnd: number,
 *   matchCount: number,
 *   matches: [...]
 * }
 */

// 你可以改成自己想要的文件夹名
var TARGET_FOLDER_NAME = "NextChat-Arena-Backups";

function doPost(e) {
  try {
    var payloadText = e && e.postData && e.postData.contents;
    if (!payloadText) {
      return _json({ ok: false, error: "empty payload" }, 400);
    }

    var data = JSON.parse(payloadText);
    var testerId = String(data.testerId || "unknown");
    var ts = Number(data.backupTime || Date.now());

    var folder = _getOrCreateFolder_(TARGET_FOLDER_NAME);

    var fileName = "arena-backup-" + testerId + "-" + ts + ".json";
    var file = folder.createFile(fileName, JSON.stringify(data, null, 2), MimeType.JSON);

    return _json({
      ok: true,
      fileId: file.getId(),
      fileName: fileName,
      folderName: TARGET_FOLDER_NAME,
      receivedAt: Date.now(),
    }, 200);
  } catch (err) {
    return _json({ ok: false, error: String(err) }, 500);
  }
}

function _getOrCreateFolder_(name) {
  var folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

function _json(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 2) 部署为 Web App（获取 Webhook URL）

1. 右上角 **Deploy** → **New deployment**
2. 类型选择 **Web app**
3. 配置：
   - **Execute as**：Me
   - **Who has access**：Anyone（或 Anyone with the link）
4. Deploy 后会得到一个 URL（类似 `https://script.google.com/macros/s/.../exec`）

这就是你的 **Webhook URL**。

---

## 3) 在 NextChat 里填入 Webhook URL

打开 Arena 管理页：
- 页面入口：`Admin` 按钮
- 对应组件：[`app/components/arena-admin.tsx`](app/components/arena-admin.tsx)

把 Web App URL 粘贴到：
- `Webhook URL（Google Apps Script Web App）`

然后点击：
- **立即触发备份**（用于验证是否能成功写入 Drive）

---

## 4) “定时”说明（非常重要）

当前项目已实现：
- **每 3 天到期检查**：[`useArenaStore.checkAndPerformBackup()`](app/store/arena.ts:207)
- **启动时补偿触发**：应用启动时会调用一次到期检查（即：你打开应用时，如果已过 3 天就会自动备份）。

但如果你要求“每天固定 08:00 定时备份”，仅靠前端页面无法保证（因为浏览器/应用没打开就不会运行）。

要做到严格 08:00 定时，推荐二选一：
1. **在 Google Apps Script 里设置 Time-driven Trigger**（每天 08:00 运行），并让 GAS 主动拉取数据（需要你提供一个可拉取数据的 API，这属于下一阶段）。
2. 用服务器/定时任务（Cron）去触发备份（同样需要可拉取数据的 API 或把数据集中存储到服务端）。

当前实现属于“客户端被动定时 + 到期补偿”。
