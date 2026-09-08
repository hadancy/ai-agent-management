# AI 智能体辅助管理平台

Electron、React 和 TypeScript 实现的光储直柔监控平台。

## PLC Modbus TCP

应用默认通过 Modbus TCP 连接 `192.168.0.1:503`，每秒使用功能码 `03` 一次读取零基 Holding Register `HR200–HR303`。PLC 标签中的 M 区字节地址按“字节地址 ÷ 2”换算为寄存器地址，`REAL` 使用大端 IEEE-754 格式。同一寄存器内，偶数 M 字节地址映射高字节，奇数 M 字节地址映射低字节。

| PLC 标签          | PLC 地址 |  Modbus 地址 | 类型  |
| ----------------- | -------- | -----------: | ----- |
| 四路光伏组串电压1 | `%MD400` |    HR200–201 | REAL  |
| 四路光伏组串电流1 | `%MD404` |    HR202–203 | REAL  |
| 四路光伏组串电压2 | `%MD408` |    HR204–205 | REAL  |
| 四路光伏组串电流2 | `%MD412` |    HR206–207 | REAL  |
| 四路光伏组串电压3 | `%MD416` |    HR208–209 | REAL  |
| 四路光伏组串电流3 | `%MD420` |    HR210–211 | REAL  |
| 四路光伏组串电压4 | `%MD424` |    HR212–213 | REAL  |
| 四路光伏组串电流4 | `%MD428` |    HR214–215 | REAL  |
| 蓄电池组电压      | `%MD500` |    HR250–251 | REAL  |
| 蓄电池组电流      | `%MD504` |    HR252–253 | REAL  |
| Plc_Year          | `%MW600` |        HR300 | UInt  |
| Plc_Mon           | `%MB602` | HR301 高字节 | USInt |
| Plc_Day           | `%MB603` | HR301 低字节 | USInt |
| Plc_Hour          | `%MB604` | HR302 高字节 | USInt |
| Plc_Min           | `%MB605` | HR302 低字节 | USInt |
| Plc_Sec           | `%MB606` | HR303 高字节 | USInt |
| Plc_weekday       | `%MB607` | HR303 低字节 | USInt |

可通过环境变量覆盖连接参数：

```bash
PLC_HOST=192.168.0.1 \
PLC_PORT=503 \
PLC_UNIT_ID=1 \
PLC_POLL_INTERVAL_MS=1000 \
npm run dev
```

如需脱离 PLC 使用模拟数据，可设置 `PLC_MODE=simulation`。模拟模式下的光伏 1–4 电压/电流依次为 `210 V / 19 A`、`210 V / 19 A`、`222 V / 21 A`、`220 V / 20 A`，蓄电池为 `52 V / 5 A`；PLC 时钟从 `2026-09-01 15:30:30` 开始按采样周期递增。

## PLC 点位调试网页

启动平台后，打开 `http://127.0.0.1:17880/plc`，或从管理端「设置中心 → PLC 点位调试」进入。同一局域网的电脑、手机可通过 `http://运行平台电脑的Wi-Fi地址:17880/plc` 访问；页面顶部提供当前局域网链接。运行平台的电脑需要能连接 PLC。这里提供的是局域网访问地址，公网访问需要另行配置网络入口。

1. 填写真实 PLC 的 IP、TCP 端口、Unit ID，以及寄存器偏移（默认 `0`，地址使用零基 HR），点击「连接并读取」。初始参数来自平台的 `PLC_HOST`、`PLC_PORT`、`PLC_UNIT_ID`、`PLC_REGISTER_OFFSET`；读取成功后在当前浏览器记住连接参数。
2. 编辑四路光伏、蓄电池的电压或电流，点击该行「写入」，或勾选多行后点击「写入已选点位」。空值和无效数值不会提交，未勾选的点位不会写入。
3. PLC 时钟的年、月、日、时、分、秒、星期整组提交。可先「填入本机时间」，再「写入 PLC 时钟」。星期采用现有映射：`1=周日`、`7=周六`；写入这些 M 区点位不等于修改 PLC CPU 的系统时钟。
4. 查看逐项写入结果，包括提交值和回读值。批量写入逐项执行，不是整个批次的原子事务；遇到拒绝、回读不一致、连接中断或超时，就停止后续点位。状态未确认时应先重新读取，不会自动重试写入。

读写通过平台后端完成：功能码 `03` 读取，功能码 `16 / 0x10` 写多个保持寄存器。每个 REAL 的两个寄存器一次写入，时钟的四个寄存器一次写入，并保持既有大端字节序；每次写入应答后立即回读比较。协议参考 [Modbus 官方规范](https://www.modbus.org/file/secure/modbusprotocolspecification.pdf)。PLC 需要开放相应寄存器及写入功能；如果梯形图/PLC 程序在每个扫描周期刷新这些 M 区变量，手动写入的值可能很快被覆盖，页面会报告回读不一致。

调试目标独立于主监控采集配置，修改调试页面 IP 不会切换监控采集目标。主监控连接同一台 PLC 时，会在后续采样中显示实际读数。调试接口即使在平台模拟模式下也操作指定的真实设备。写入请求与结果记录在本地事件日志中。

验证读写实现（仅连接本机临时 Modbus 服务，不操作真实设备）：

```bash
npm run test:plc
```

## Pad 局域网访问地址

内置服务仍监听所有网卡，但管理端生成和分享的 Pad 地址固定使用 Wi-Fi 网卡的 IPv4 地址。Windows 会优先根据系统报告的 NDIS 无线物理介质识别真实 Wi-Fi 网卡，不依赖网卡显示名称；macOS 默认识别 `en0`，Linux 默认识别常见的 `wlan`/`wlp` 网卡。

如果设备的 Wi-Fi 网卡名称不同，可用 `APP_WIFI_INTERFACE` 明确指定：

```bash
APP_WIFI_INTERFACE=en0 npm run dev
```

Windows PowerShell 示例：

```powershell
$env:APP_WIFI_INTERFACE='Wi-Fi'
npm run dev
```

Wi-Fi 网卡没有活动 IPv4 地址时，应用会在终端打印警告并把分享地址限制为 `127.0.0.1`，不会自动切换到有线或虚拟网卡；应用本身仍可在本机启动。建议在路由器中为运行软件的电脑设置 DHCP 地址保留，避免分享链接随 Wi-Fi 地址变化。

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
