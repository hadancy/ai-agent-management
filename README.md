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

## Pad 局域网访问地址

内置服务仍监听所有网卡，但管理端生成和分享的 Pad 地址固定使用 Wi-Fi 网卡的 IPv4 地址。应用会自动识别 macOS 的 `en0`、Windows 常见的 `Wi-Fi`/`WLAN` 以及 Linux 常见的 `wlan`/`wlp` 网卡。

如果设备的 Wi-Fi 网卡名称不同，可用 `APP_WIFI_INTERFACE` 明确指定：

```bash
APP_WIFI_INTERFACE=en0 npm run dev
```

Windows PowerShell 示例：

```powershell
$env:APP_WIFI_INTERFACE='Wi-Fi'
npm run dev
```

Wi-Fi 网卡没有活动 IPv4 地址时，应用会在终端打印警告并回退到其他可用局域网地址，以保证应用仍可启动。建议在路由器中为运行软件的电脑设置 DHCP 地址保留，避免分享链接随 Wi-Fi 地址变化。

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
