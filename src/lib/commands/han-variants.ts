// Traditional and Simplified Chinese characters that are the same letter written two ways, for names. A child called 王伟 is also
// written 王偉; both must be found. This is a small table of the characters that matter in names (family names and the common
// given-name characters), not a converter: a character that is not here is compared as written. Each pair is
// "traditional simplified". Pure data.

const PAIRS =
  "偉伟 傑杰 華华 剛刚 強强 豔艳 艷艳 靜静 麗丽 紅红 蘭兰 鳳凤 雲云 穎颖 鵬鹏 飛飞 龍龙 軒轩 濤涛 陽阳 東东 軍军 國国 榮荣 輝辉 歡欢 銘铭 藝艺 倫伦 " +
  "鄧邓 陳陈 張张 劉刘 楊杨 黃黄 趙赵 吳吴 孫孙 馬马 鄭郑 謝谢 許许 韓韩 馮冯 蕭萧 蔣蒋 葉叶 蘇苏 呂吕 盧卢 鍾钟 鐘钟 譚谭 陸陆 賈贾 韋韦 鄒邹 " +
  "閆闫 賀贺 顧顾 龔龚 萬万 錢钱 嚴严 湯汤 於于 羅罗 聶聂 莊庄 藍蓝 魯鲁 閔闵 衛卫 蔡蔡 慶庆 傳传 學学 賢贤 賜赐 緯纬 緒绪 維维 繼继 義义 聖圣 " +
  "濟济 澤泽 瑩莹 瑤瑶 嬌娇 嫻娴 鈺钰 銳锐 鋒锋 鍵键 鎮镇 韜韬 韻韵 頤颐 顏颜 風风 驍骁 駿骏 騰腾 鮮鲜 鴻鸿 鶴鹤 麥麦 齊齐 龐庞 寶宝 實实 寧宁 " +
  "專专 尋寻 對对 導导 屆届 嶺岭 巖岩 後后 從从 恆恒 悅悦 愛爱 憲宪 懷怀 戰战 揚扬 敘叙 昇升 暉晖 曉晓 曄晔 書书 會会 楓枫 業业 樂乐 樹树 橋桥 " +
  "檸柠 權权 歐欧 漢汉 潔洁 瀟潇 灣湾 煒炜 爾尔 環环 瑋玮 矯矫 碩硕 禮礼 禎祯 簡简 紀纪 紹绍 終终 綠绿 縉缙 繆缪 翹翘 聰聪 肅肃 臺台 興兴 舉举 " +
  "蓮莲 親亲 觀观 計计 訓训 設设 詩诗 誠诚 說说 謙谦 譽誉 豐丰 貝贝 贏赢 輪轮 轉转 農农 週周 達达 運运 邊边 鄉乡 醫医 釗钊 銀银 鋼钢 長长 門门 " +
  "間间 際际 難难 電电 靈灵 順顺 領领 養养 驚惊 鬱郁 鳴鸣 點点 齡龄 廣广 鄺邝 蔔卜 鄔邬 嶽岳 區区 單单 麼么 滿满 戴戴 範范 兒儿 衛卫";

const MAP = new Map<string, string>();
for (const pair of PAIRS.split(/\s+/)) {
  const [trad, simp] = Array.from(pair);
  if (trad && simp && trad !== simp) MAP.set(trad, simp);
}

/** The Simplified form of a Traditional character in the table, or the character itself. */
export function simplifiedHan(ch: string): string {
  return MAP.get(ch) ?? ch;
}
