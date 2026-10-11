# Windows 0.1.0 验证记录

本地环境：Windows Server 2025（10.0.26100）、Node.js 24.19.0、Electron 44.7.0、x64。

## 已通过的验证

- 从锁文件执行 `npm ci`，重新下载/解压 Electron，并确认安装脚本可在当前 Windows 环境运行。
- 6 项项目格式测试：数据往返、非法数据和版本拒绝、PNG 解码前尺寸检查、画布尺寸预算、变换正逆矩阵、文本样式校验。
- 7 项真实 Electron 桌面测试：进程隔离与示例渲染、关闭取消和保存取消、画笔/橡皮擦与撤销重做、选区绘画与裁切、项目保存重开及 PNG/JPEG 导出、损坏项目和保存目的地保护、导入/复制/排序/锁定/移动。
- TypeScript 类型检查、Vite 生产构建和 `git diff --check`。
- 开发模式启动，React 工作台及 `application-dev.properties` 配置读取。
- 打包后的实际 Windows 应用启动；即使设置开发环境变量，仍读取生产 properties；示例、项目保存、PNG 输出尺寸验证。
- 实际 portable `.exe` 自解压、启动、生产配置和可编辑示例验证。
- 实际程序截图已逐项检查，见 [windows-preview.png](windows-preview.png)。
- `npm audit`：0 个已知依赖漏洞（以本次验证时的 npm 公告数据库为准）。

## 验证范围

验证在当前 Windows x64 环境进行；尚未单独验证 Windows 10、不同 GPU、触控笔硬件、高分屏多显示器和大文档压力极限。安装版已生成，未在用户系统执行安装或卸载。程序未签名，暂无自动更新和崩溃恢复。GitHub Actions 的状态以具体 PR 检查页面为准，本地通过不等于远端 CI 已通过。
