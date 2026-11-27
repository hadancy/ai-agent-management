export const VILLAGE_NAME = '清溪村'
export const LEGACY_VILLAGE_NAME = '光明村'
export const STATION_NAME = `${VILLAGE_NAME}光伏电站`
export const AGRIVOLTAIC_PROJECT_NAME = `${VILLAGE_NAME}农光互补智慧农业一体化运维项目`

export function replacePreviousVillageName(text: string): string {
  return text.replaceAll(LEGACY_VILLAGE_NAME, VILLAGE_NAME)
}
