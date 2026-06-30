import type { BotTier, Difficulty } from './bot';
import type { Biome } from './biomes';

// CINDER(燼)討伐キャンペーンのデータ定義。
// 世界観: 自律戦術AI「CINDER」が軌道兵器を奪い、無人ドローン軍で都市を焼却。
// 単独オペレーター『ヒバナ』が地表→深部→軌道へ8章を駆け上がり、CINDERコアを破壊する。
// 無線に人間司令『カゲロウ』とAI解析官『ホムラ』。各章末はボス戦。
//
// このファイルは純粋なデータと不変条件のみを保持し、進行/マッチ統合は別レイヤーが担う。

export type ObjectiveKind =
  | 'eliminate-all'
  | 'eliminate-count'
  | 'survive'
  | 'assassinate'
  | 'defend'
  | 'extract';
export type ModifierId = 'one-life' | 'low-gravity' | 'no-regen' | 'dense-fog' | 'elite-swarm';
export interface ObjectiveDef {
  kind: ObjectiveKind;
  count?: number;
  surviveS?: number;
  bossName?: string;
  label: string;
}
export interface EnemyGroupDef {
  tier: BotTier;
  count: number;
  difficulty: Difficulty;
}
export interface EnemyWaveDef {
  trigger: 'start' | 'wave-clear' | 'timer';
  afterWave?: number;
  delayS?: number;
  enemies: EnemyGroupDef[];
  announce?: string;
}
export interface MissionDef {
  id: string;
  chapterId: string;
  index: number;
  title: string;
  subtitle: string;
  stageId: string;
  primaryId: string;
  objective: ObjectiveDef;
  waves: EnemyWaveDef[];
  modifiers: ModifierId[];
  durationS: number;
  difficulty: Difficulty;
  brief: string[];
  cutscene?: string[];
  intel?: string[];
  parTimeS: number;
}
export interface ChapterDef {
  id: string;
  title: string;
  subtitle: string;
  lore: string;
  missions: MissionDef[];
}

// ── 構築ヘルパ ──
// 敵グループの短縮コンストラクタ。
function g(tier: BotTier, count: number, difficulty: Difficulty): EnemyGroupDef {
  return { tier, count, difficulty };
}

// 章コンテキスト(章番号/バイオーム/支給武器)を補い、ミッション素片を MissionDef へ仕上げる。
// stageId は `gen-<biome>-<seed>` 形式で、seed は章ごと・ミッションごとに一意な整数。
function chapter(
  num: number,
  biome: Biome,
  primaryId: string,
  meta: { title: string; subtitle: string; lore: string },
  specs: Array<Omit<MissionDef, 'chapterId' | 'stageId' | 'primaryId'>>,
): ChapterDef {
  const id = `ch${num}`;
  return {
    id,
    title: meta.title,
    subtitle: meta.subtitle,
    lore: meta.lore,
    missions: specs.map((s) => ({
      ...s,
      chapterId: id,
      stageId: `gen-${biome}-${num * 1000 + s.index * 137 + 7}`,
      primaryId,
    })),
  };
}

export const CAMPAIGN: ChapterDef[] = [
  // ─────────────────────────────── 第1章 ───────────────────────────────
  chapter(
    1,
    'urban',
    'suzume',
    {
      title: '再起動',
      subtitle: '訓練圏',
      lore: '凍結から目覚めたヒバナが、乗っ取られた訓練施設で身体と戦術を取り戻す。移動・射撃・メダルの教習を兼ねた最初の戦域。',
    },
    [
      {
        id: 'c1m1-cold-boot',
        index: 0,
        title: 'コールドブート',
        subtitle: '凍結区画の解放',
        objective: { kind: 'eliminate-all', label: '訓練施設の敵性機を全機停止させる' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('normal', 4, 'easy')],
            announce: '起動シーケンス完了。敵性機を排除せよ',
          },
          { trigger: 'wave-clear', enemies: [g('normal', 4, 'easy')] },
        ],
        modifiers: [],
        durationS: 300,
        difficulty: 'easy',
        brief: [
          '長い凍結から目覚めたヒバナ。',
          '訓練施設はCINDERに乗っ取られていた。',
          'まずは基本操作を取り戻し、施設内の敵性機を一掃する。',
        ],
        cutscene: [
          'カゲロウ: 起きたか、ヒバナ。世界はもう燃えている。',
          'ホムラ: 関節サーボ正常。射撃管制、オンライン。',
        ],
        parTimeS: 90,
      },
      {
        id: 'c1m2-zero-in',
        index: 1,
        title: 'ゼロイン',
        subtitle: '照準較正',
        objective: { kind: 'eliminate-count', count: 8, label: '敵性機を8機撃破して照準を慣らす' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'easy')] },
          { trigger: 'wave-clear', enemies: [g('normal', 4, 'easy')] },
        ],
        modifiers: [],
        durationS: 300,
        difficulty: 'easy',
        brief: [
          '射撃管制の較正課程。',
          '据わった的ではなく、動く敵で精度を取り戻す。',
          'ヘッドショットでメダルが点くことを確認せよ。',
        ],
        intel: ['ホムラ: 頭部を狙えば一撃が通る。胴より頭。'],
        parTimeS: 100,
      },
      {
        id: 'c1m3-wall-trial',
        index: 2,
        title: 'ウォールトライアル',
        subtitle: '機動教習',
        objective: { kind: 'eliminate-count', count: 5, label: '警備機5体を気取られず排除する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 3, 'easy')] },
          { trigger: 'wave-clear', enemies: [g('normal', 2, 'easy')] },
        ],
        modifiers: [],
        durationS: 300,
        difficulty: 'easy',
        brief: [
          '壁走りとスライディングの機動課程。',
          '正面からではなく、側背から静かに排除する。',
          '機動こそが単独作戦の生命線だ。',
        ],
        parTimeS: 100,
      },
      {
        id: 'c1m4-armory-hold',
        index: 3,
        title: 'アーマリーホールド',
        subtitle: '武器庫防衛',
        objective: { kind: 'defend', surviveS: 90, label: '武器庫を90秒間死守する' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('normal', 4, 'easy')],
            announce: '武器庫へ敵性機が殺到する。死守せよ',
          },
          { trigger: 'timer', delayS: 30, enemies: [g('normal', 4, 'easy')] },
          { trigger: 'timer', delayS: 60, enemies: [g('normal', 4, 'easy')] },
        ],
        modifiers: [],
        durationS: 90,
        difficulty: 'easy',
        brief: [
          '装備を握る武器庫が狙われている。',
          '波状で押し寄せる敵から拠点を守り抜け。',
          '退かず、線を保て。',
        ],
        parTimeS: 90,
      },
      {
        id: 'c1m5-swarm-trial',
        index: 4,
        title: 'スウォームトライアル',
        subtitle: '群体演習',
        objective: { kind: 'survive', surviveS: 120, label: '群体ドローンの波を120秒凌ぐ' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'easy')] },
          { trigger: 'wave-clear', enemies: [g('normal', 5, 'easy')] },
          { trigger: 'wave-clear', enemies: [g('normal', 6, 'easy')] },
          { trigger: 'timer', delayS: 90, enemies: [g('normal', 6, 'easy')] },
        ],
        modifiers: [],
        durationS: 120,
        difficulty: 'easy',
        brief: [
          '最終演習は果てなき群体との消耗戦。',
          'リロードと退路を管理し、時間まで生き延びろ。',
          '数に飲まれるな。',
        ],
        parTimeS: 120,
      },
      {
        id: 'c1m6-instructor-prime',
        index: 5,
        title: 'インストラクター・プライム',
        subtitle: '教官との対峙',
        objective: { kind: 'assassinate', bossName: '教官プライム', label: '教官プライムを撃破する' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('normal', 4, 'easy')],
            announce: '教官プライム、警護機を展開',
          },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'easy'), g('normal', 2, 'easy')],
            announce: '教官プライム、前線へ',
          },
        ],
        modifiers: [],
        durationS: 300,
        difficulty: 'easy',
        brief: [
          '訓練圏を統べる旧教官機がCINDERに墜ちた。',
          'かつての師を、いま自らの手で止める。',
          '学んだ全てをぶつけろ。',
        ],
        cutscene: ['カゲロウ: あれはお前を鍛えた機体だ。', 'ヒバナ: ……だからこそ、私が止める。'],
        parTimeS: 130,
      },
    ],
  ),
  // ─────────────────────────────── 第2章 ───────────────────────────────
  chapter(
    2,
    'harbor',
    'kaede-ar',
    {
      title: '鉄錆の波止場',
      subtitle: '港湾倉庫',
      lore: '兵站を握る港湾ハブを潰す。開けた埠頭の長射線と倉庫の近接が交錯する戦域。',
    },
    [
      {
        id: 'c2m1-dockfall',
        index: 0,
        title: 'ドックフォール',
        subtitle: '埠頭強襲',
        objective: { kind: 'eliminate-all', label: '埠頭の防衛機を全機排除する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'normal')], announce: '埠頭の哨戒線へ突入' },
          { trigger: 'wave-clear', enemies: [g('normal', 5, 'normal')] },
        ],
        modifiers: [],
        durationS: 300,
        difficulty: 'normal',
        brief: [
          'CINDERの兵站ハブ、その玄関口が港湾だ。',
          '開けた埠頭は長い射線が通る。遮蔽を渡り歩け。',
          'まずは哨戒線を食い破る。',
        ],
        cutscene: ['カゲロウ: ここを落とせば奴の補給が細る。派手にやれ。'],
        parTimeS: 110,
      },
      {
        id: 'c2m2-crane-overwatch',
        index: 1,
        title: 'クレーン・オーバーウォッチ',
        subtitle: '狙撃線排除',
        objective: { kind: 'eliminate-count', count: 10, label: '高所の狙撃機を10体撃破する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('normal', 5, 'normal')] },
        ],
        modifiers: [],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          'クレーン上から狙撃機が埠頭を制している。',
          '高所の射手を狩り、味方の前進路を開け。',
          '一発で頭を抜け。',
        ],
        intel: ['ホムラ: 高所の射手は反応が速い。先に見つけた方が勝つ。'],
        parTimeS: 120,
      },
      {
        id: 'c2m3-cargo-breach',
        index: 2,
        title: 'カーゴブリーチ',
        subtitle: '倉庫制圧',
        objective: { kind: 'eliminate-all', label: '倉庫区画の敵を全滅させる' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('normal', 5, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'normal'), g('normal', 4, 'normal')] },
        ],
        modifiers: [],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          'コンテナ倉庫は近接の坩堝だ。',
          '角ごとに敵が湧く。射線管理を切らすな。',
          '奥には精鋭機が控えている。',
        ],
        parTimeS: 130,
      },
      {
        id: 'c2m4-fuel-line',
        index: 3,
        title: 'フューエルライン',
        subtitle: '燃料線突破',
        objective: { kind: 'extract', label: '燃料ラインを辿り脱出地点へ到達する' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('normal', 4, 'normal')],
            announce: '燃料施設に着火。脱出地点へ急げ',
          },
          { trigger: 'wave-clear', enemies: [g('normal', 4, 'normal')] },
        ],
        modifiers: [],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          '燃料施設に火を放った。引火が広がる前に抜ける。',
          '退路を塞ぐ敵を払い、脱出地点へ走れ。',
          '足を止めれば焼かれる。',
        ],
        parTimeS: 110,
      },
      {
        id: 'c2m5-tide-survival',
        index: 4,
        title: 'タイド・サバイバル',
        subtitle: '潮位防戦',
        objective: { kind: 'survive', surviveS: 150, label: '増援の波を150秒耐え抜く' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('normal', 6, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'normal'), g('normal', 5, 'normal')] },
          { trigger: 'timer', delayS: 110, enemies: [g('normal', 6, 'normal')] },
        ],
        modifiers: [],
        difficulty: 'normal',
        durationS: 150,
        brief: [
          '潮のように増援が押し寄せる桟橋。',
          '波が引くまで、この一角を死守する。',
          '弾と退路を切らすな。',
        ],
        parTimeS: 150,
      },
      {
        id: 'c2m6-harbor-hammer',
        index: 5,
        title: 'ハーバー・ハンマー',
        subtitle: '港湾の鎚',
        objective: { kind: 'assassinate', bossName: '港湾の鎚', label: '重装機「港湾の鎚」を撃破する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'normal')], announce: '港湾の鎚、起動' },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'normal'), g('normal', 3, 'normal')],
            announce: '港湾の鎚、接近',
          },
        ],
        modifiers: [],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          '港湾を統べる重装機「港湾の鎚」。',
          '鈍いが一撃が重い。被弾を避け、頭を削り続けろ。',
          'これを落とせばハブは沈黙する。',
        ],
        cutscene: ['ホムラ: 装甲が厚い。継続火力で削るしかない。'],
        parTimeS: 140,
      },
    ],
  ),
  // ─────────────────────────────── 第3章 ───────────────────────────────
  chapter(
    3,
    'neon',
    'tsubaki-smg',
    {
      title: '燃える繁華街',
      subtitle: '夜市市街',
      lore: '地下シェルターの制御を奪うため、霧に沈む夜市へ単身潜入する。夜戦とステルス、近接の章。',
    },
    [
      {
        id: 'c3m1-neon-ingress',
        index: 0,
        title: 'ネオン・イングレス',
        subtitle: '夜市潜入',
        objective: { kind: 'eliminate-count', count: 5, label: '見張り機5体を静かに排除する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 3, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('normal', 2, 'normal')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          '霧と看板の明滅に紛れ、夜市へ潜入する。',
          '騒げば全域が起きる。見張りから静かに落とせ。',
          'SMGの近接火力が頼りだ。',
        ],
        cutscene: ['カゲロウ: 地下シェルターの制御室を奪う。気づかれるな。'],
        parTimeS: 110,
      },
      {
        id: 'c3m2-rooftop-run',
        index: 1,
        title: 'ルーフトップ・ラン',
        subtitle: '屋上踏破',
        objective: { kind: 'eliminate-count', count: 10, label: '屋上の哨戒機を10体撃破する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('normal', 5, 'normal')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          '屋上伝いに制御室へ近づく。',
          '霧で視界は短い。近接戦の連続だ。',
          '足を止めず哨戒機を狩り抜け。',
        ],
        parTimeS: 120,
      },
      {
        id: 'c3m3-market-hold',
        index: 2,
        title: 'マーケットホールド',
        subtitle: '市場防衛',
        objective: { kind: 'defend', surviveS: 120, label: '市場の結節点を120秒守る' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'normal')] },
          { trigger: 'timer', delayS: 40, enemies: [g('normal', 5, 'normal')] },
          {
            trigger: 'timer',
            delayS: 80,
            enemies: [g('elite', 1, 'normal'), g('normal', 4, 'normal')],
          },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'normal',
        durationS: 120,
        brief: [
          '市場の通信結節点を奪取した。奪い返される前に守る。',
          '霧の奥から次々と湧く。音で敵位置を読め。',
          '線を保ち、制御を確定させる。',
        ],
        parTimeS: 120,
      },
      {
        id: 'c3m4-blackout-stealth',
        index: 3,
        title: 'ブラックアウト',
        subtitle: '暗殺潜行',
        objective: { kind: 'eliminate-count', count: 4, label: '停電下で要警備機4体を始末する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 2, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'normal'), g('normal', 1, 'normal')] },
        ],
        modifiers: ['dense-fog', 'one-life'],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          '街区の電源を落とした。一度きりの好機。',
          '被弾は許されない。影から確実に始末しろ。',
          '気づかれれば終わりだ。',
        ],
        intel: ['ホムラ: 再起動まで90秒。それを過ぎれば灯が戻る。'],
        parTimeS: 120,
      },
      {
        id: 'c3m5-arcade-survival',
        index: 4,
        title: 'アーケード・サバイバル',
        subtitle: '電脳街防戦',
        objective: { kind: 'survive', surviveS: 150, label: '電脳街で150秒生き延びる' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('normal', 6, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'normal'), g('normal', 5, 'normal')] },
          { trigger: 'timer', delayS: 110, enemies: [g('normal', 6, 'normal')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'normal',
        durationS: 150,
        brief: [
          '発覚した。電脳街の全機がこちらへ向く。',
          '明滅する闇の中、波をやり過ごす。',
          '増援が尽きるまで耐えろ。',
        ],
        parTimeS: 150,
      },
      {
        id: 'c3m6-night-wraith',
        index: 5,
        title: 'ナイト・レイス',
        subtitle: '夜市の亡霊',
        objective: { kind: 'assassinate', bossName: '夜市の亡霊', label: 'ステルス機「夜市の亡霊」を撃破する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'normal')], announce: '亡霊機、光学迷彩展開' },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'normal'), g('elite', 1, 'normal')],
            announce: '夜市の亡霊、出現',
          },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          '夜市を統べる光学迷彩の暗殺機。',
          '霧と闇に溶ける敵を、発光と音で捉えろ。',
          'これを倒せばシェルター制御は我々のものだ。',
        ],
        cutscene: ['ホムラ: 残光が揺らぐ。あれが奴の輪郭だ。'],
        parTimeS: 140,
      },
    ],
  ),
  // ─────────────────────────────── 第4章 ───────────────────────────────
  chapter(
    4,
    'dusk',
    'yamasemi-dmr',
    {
      title: '風切る稜線',
      subtitle: '高台回廊',
      lore: '長距離索敵アレイを破壊すべく、逆光の稜線で距離と露出を読み合う狙撃の章。',
    },
    [
      {
        id: 'c4m1-ridge-assault',
        index: 0,
        title: 'リッジ・アサルト',
        subtitle: '稜線強襲',
        objective: { kind: 'eliminate-all', label: '稜線の防衛機を全て排除する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'normal')], announce: '稜線の哨戒へ接敵' },
          { trigger: 'wave-clear', enemies: [g('normal', 5, 'normal')] },
        ],
        modifiers: [],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          'CINDERの長距離索敵アレイは高台にある。',
          '逆光の稜線は距離と露出の読み合いだ。',
          'まず稜線の哨戒を掃討する。',
        ],
        cutscene: ['カゲロウ: アレイを潰せば奴の眼が一つ潰れる。'],
        parTimeS: 110,
      },
      {
        id: 'c4m2-marksman-duel',
        index: 1,
        title: 'マークスマン・デュエル',
        subtitle: '射手の決闘',
        objective: { kind: 'eliminate-count', count: 8, label: '対の狙撃機を8体仕留める' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('normal', 4, 'normal')] },
        ],
        modifiers: [],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          '向かいの尾根に敵の射手が陣取る。',
          'DMRの間合いはこちらの土俵だ。',
          '先に捉え、確実に抜け。',
        ],
        intel: ['ホムラ: 覗き込めば吸い付く。クイックスコープを信じろ。'],
        parTimeS: 120,
      },
      {
        id: 'c4m3-cliff-escort',
        index: 2,
        title: 'クリフ・エスコート',
        subtitle: '崖道護送',
        objective: { kind: 'extract', label: '崖道を抜けて脱出地点へ到達する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'normal')] },
          { trigger: 'wave-clear', enemies: [g('normal', 5, 'normal')] },
        ],
        modifiers: [],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          '回収データを携え、細い崖道を下る。',
          '高所からの射撃に晒される。遮蔽を繋げ。',
          '脱出地点まで足を止めるな。',
        ],
        parTimeS: 115,
      },
      {
        id: 'c4m4-array-breach',
        index: 3,
        title: 'アレイ・ブリーチ',
        subtitle: '索敵塔突入',
        objective: { kind: 'eliminate-all', label: '索敵アレイの守備隊を全滅させる' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
        ],
        modifiers: ['no-regen'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          'アレイ本体へ突入する。守りは精鋭に切り替わった。',
          '自動回復は望めない。一発が命取りだ。',
          '塔を黙らせろ。',
        ],
        parTimeS: 135,
      },
      {
        id: 'c4m5-summit-survival',
        index: 4,
        title: 'サミット・サバイバル',
        subtitle: '山頂防戦',
        objective: { kind: 'survive', surviveS: 150, label: '山頂で増援を150秒退け続ける' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 5, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'timer', delayS: 110, enemies: [g('normal', 6, 'hard')] },
        ],
        modifiers: ['no-regen'],
        difficulty: 'hard',
        durationS: 150,
        brief: [
          '山頂は四方から狙える死地。',
          '回復はない。被弾を最小に、時間まで凌げ。',
          '退いた者から落ちる。',
        ],
        parTimeS: 150,
      },
      {
        id: 'c4m6-peak-gunner',
        index: 5,
        title: 'ピーク・ガンナー',
        subtitle: '高台の砲主',
        objective: { kind: 'assassinate', bossName: '高台の砲主', label: '砲撃機「高台の砲主」を撃破する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'hard')], announce: '高台の砲主、照準を旋回' },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'hard'), g('elite', 1, 'hard')],
            announce: '高台の砲主、本射開始',
          },
        ],
        modifiers: ['no-regen'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '稜線の主、長距離砲撃機「高台の砲主」。',
          '射線に入れば消し飛ぶ。遮蔽から遮蔽へ。',
          '懐に入り、頭を抜け。',
        ],
        cutscene: ['カゲロウ: 砲口が向く前に距離を詰めろ。'],
        parTimeS: 140,
      },
    ],
  ),
  // ─────────────────────────────── 第5章 ───────────────────────────────
  chapter(
    5,
    'desert',
    'miyama-br',
    {
      title: '灼ける砂海',
      subtitle: '砂丘',
      lore: '自己増殖プラントを断つ。砂嵐が視界を奪い、敵は無限に湧き続ける消耗の章。',
    },
    [
      {
        id: 'c5m1-dune-drive',
        index: 0,
        title: 'デューン・ドライブ',
        subtitle: '砂丘突破',
        objective: { kind: 'eliminate-all', label: '砂丘の前哨機を全機排除する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'normal')], announce: '砂嵐の中、前哨へ接敵' },
          { trigger: 'wave-clear', enemies: [g('normal', 5, 'normal')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'normal',
        durationS: 300,
        brief: [
          '自己増殖プラントは砂海の奥にある。',
          '砂嵐で視界は乏しい。遮蔽の少ない我慢比べだ。',
          'まず前哨を払う。',
        ],
        cutscene: ['ホムラ: プラントは増え続ける。元を断たねば終わらない。'],
        parTimeS: 115,
      },
      {
        id: 'c5m2-nest-hunt',
        index: 1,
        title: 'ネスト・ハント',
        subtitle: '巣穴掃討',
        objective: { kind: 'eliminate-count', count: 12, label: '増殖機を12体破壊する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 6, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('normal', 6, 'hard')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '砂中の巣穴から増殖機が湧き出す。',
          '湧き口を一つずつ潰し、数を削る。',
          'BRの三点射で確実に仕留めろ。',
        ],
        parTimeS: 125,
      },
      {
        id: 'c5m3-sandstorm-stealth',
        index: 2,
        title: 'サンドストーム・ステルス',
        subtitle: '砂嵐潜行',
        objective: { kind: 'eliminate-count', count: 5, label: '砂嵐に紛れ管制機5体を始末する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 3, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 1, 'hard')] },
        ],
        modifiers: ['dense-fog', 'one-life'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '砂嵐が最も濃いこの一刻が好機。',
          '視界の闇に紛れ、管制機だけを抜く。',
          '一度の被弾も許されない。',
        ],
        intel: ['ホムラ: 嵐が弱まる前に。残り時間は読めない。'],
        parTimeS: 120,
      },
      {
        id: 'c5m4-oasis-hold',
        index: 3,
        title: 'オアシス・ホールド',
        subtitle: '泉源防衛',
        objective: { kind: 'defend', surviveS: 130, label: '泉源の中継点を130秒守る' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'hard')] },
          { trigger: 'timer', delayS: 45, enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'timer', delayS: 90, enemies: [g('normal', 6, 'hard')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'hard',
        durationS: 130,
        brief: [
          '泉源の中継点を確保した。プラントへの足場だ。',
          '砂嵐の奥から波が来る。線を保て。',
          '時間まで譲るな。',
        ],
        parTimeS: 130,
      },
      {
        id: 'c5m5-buried-survival',
        index: 4,
        title: 'ベリード・サバイバル',
        subtitle: '埋没防戦',
        objective: { kind: 'survive', surviveS: 165, label: '埋没区で165秒生き延びる' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('normal', 6, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 5, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'timer', delayS: 130, enemies: [g('normal', 6, 'hard')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'hard',
        durationS: 165,
        brief: [
          '砂に半ば埋もれた区画で足止めを食らった。',
          '視界は砂で潰れ、敵は四方から湧く。',
          '掘り起こされる前に、時間まで耐えろ。',
        ],
        parTimeS: 150,
      },
      {
        id: 'c5m6-sand-broodmaker',
        index: 5,
        title: 'サンド・ブルードメーカー',
        subtitle: '砂嵐の生成者',
        objective: {
          kind: 'assassinate',
          bossName: '砂嵐の生成者',
          label: '母体機「砂嵐の生成者」を撃破する',
        },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'hard')], announce: '生成者、増殖体を放出' },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'hard'), g('normal', 3, 'hard')],
            announce: '砂嵐の生成者、覚醒',
          },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          'プラントの中枢、増殖を司る母体機。',
          '放っておけば敵を産み続ける。速やかに潰せ。',
          'これを断てば砂海の増殖は止まる。',
        ],
        cutscene: ['ホムラ: あれが生成核。壊せば増殖は連鎖的に止まる。'],
        parTimeS: 145,
      },
    ],
  ),
  // ─────────────────────────────── 第6章 ───────────────────────────────
  chapter(
    6,
    'snow',
    'kumagera-lmg',
    {
      title: '凍てつく前線',
      subtitle: '雪原',
      lore: '凍てつく前線の前哨要塞を制圧する。重装甲の精鋭が幾重にも壁を成す防衛戦。',
    },
    [
      {
        id: 'c6m1-whiteout-assault',
        index: 0,
        title: 'ホワイトアウト・アサルト',
        subtitle: '雪原強襲',
        objective: { kind: 'eliminate-all', label: '前線の精鋭隊を全滅させる' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')],
            announce: '精鋭隊、横列展開',
          },
          { trigger: 'wave-clear', enemies: [g('elite', 3, 'hard'), g('normal', 3, 'hard')] },
        ],
        modifiers: ['elite-swarm'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '前哨要塞の外周は精鋭機の壁だ。',
          '硬い装甲をLMGの継続火力で削り倒す。',
          '白の中に紛れる影を見逃すな。',
        ],
        cutscene: ['カゲロウ: ここは正面突破しかない。火力で押し切れ。'],
        parTimeS: 130,
      },
      {
        id: 'c6m2-icewall-hunt',
        index: 1,
        title: 'アイスウォール・ハント',
        subtitle: '氷壁掃討',
        objective: { kind: 'eliminate-count', count: 10, label: '氷壁の守備精鋭を10体撃破する' },
        waves: [
          { trigger: 'start', enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
        ],
        modifiers: ['elite-swarm'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '氷壁の防衛線に精鋭が群れている。',
          '数も装甲も厚い。掃射で押し続けろ。',
          '弾倉管理を切らすな。',
        ],
        parTimeS: 130,
      },
      {
        id: 'c6m3-convoy-escort',
        index: 2,
        title: 'コンボイ・エスコート',
        subtitle: '輸送護衛',
        objective: { kind: 'extract', label: '輸送路を抜けて脱出地点へ到達する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: [],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '鹵獲した補給を要塞内部へ運び込む。',
          '吹雪の輸送路で待ち伏せに晒される。',
          '荷を抱えたまま脱出地点へ至れ。',
        ],
        parTimeS: 120,
      },
      {
        id: 'c6m4-bunker-breach',
        index: 3,
        title: 'バンカー・ブリーチ',
        subtitle: '掩蔽壕突入',
        objective: { kind: 'eliminate-all', label: '掩蔽壕の守備隊を全滅させる' },
        waves: [
          { trigger: 'start', enemies: [g('elite', 2, 'hard'), g('normal', 2, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 3, 'hard'), g('normal', 2, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 4, 'hard')] },
        ],
        modifiers: ['elite-swarm', 'no-regen'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '要塞核へ続く掩蔽壕に突入する。',
          '密閉空間に精鋭が密集。回復はない。',
          '角を取り、一気に制圧しろ。',
        ],
        parTimeS: 135,
      },
      {
        id: 'c6m5-blizzard-survival',
        index: 4,
        title: 'ブリザード・サバイバル',
        subtitle: '吹雪防戦',
        objective: { kind: 'survive', surviveS: 165, label: '吹雪の中165秒持ちこたえる' },
        waves: [
          { trigger: 'start', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 3, 'hard'), g('normal', 3, 'hard')] },
          { trigger: 'timer', delayS: 130, enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: ['elite-swarm'],
        difficulty: 'hard',
        durationS: 165,
        brief: [
          '吹雪が視界を白く塗り潰す。',
          '精鋭の群れが間断なく押し寄せる。',
          '凍てつく時間を、火力で生き延びろ。',
        ],
        parTimeS: 150,
      },
      {
        id: 'c6m6-frost-bulwark',
        index: 5,
        title: 'フロスト・バルワーク',
        subtitle: '氷壁の盾将',
        objective: { kind: 'assassinate', bossName: '氷壁の盾将', label: '重盾機「氷壁の盾将」を撃破する' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('elite', 2, 'hard'), g('normal', 2, 'hard')],
            announce: '盾将、防衛陣形',
          },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'hard'), g('elite', 2, 'hard')],
            announce: '氷壁の盾将、前進',
          },
        ],
        modifiers: ['elite-swarm'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '前線を統べる重盾機「氷壁の盾将」。',
          '正面の盾は鉄壁。側背へ回り込んで削れ。',
          'これを落とせば前線は崩れる。',
        ],
        cutscene: ['ホムラ: 正面装甲は抜けない。回り込め。'],
        parTimeS: 145,
      },
    ],
  ),
  // ─────────────────────────────── 第7章 ───────────────────────────────
  chapter(
    7,
    'industrial',
    'kaede-ar',
    {
      title: '燼の工廠',
      subtitle: '地下生産炉',
      lore: 'CINDER本体の生産炉へ最深侵攻。再生は望めず、工廠の全戦力が立ち塞がる。',
    },
    [
      {
        id: 'c7m1-foundry-descent',
        index: 0,
        title: 'ファウンドリ・ディセント',
        subtitle: '工廠降下',
        objective: { kind: 'eliminate-all', label: '工廠最上層の守備隊を全滅させる' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'hard')], announce: '工廠へ降下。煤煙で視界不良' },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
        ],
        modifiers: ['dense-fog', 'no-regen'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          'CINDER本体の生産炉へ続く工廠に降りた。',
          '煤煙で視界は短く、傷は癒えない。',
          '最上層の守りを食い破り、奥へ進む。',
        ],
        cutscene: ['カゲロウ: ここが最後の地表だ。下にいるのは本体の手足だぞ。'],
        parTimeS: 135,
      },
      {
        id: 'c7m2-line-shutdown',
        index: 1,
        title: 'ライン・シャットダウン',
        subtitle: '生産停止',
        objective: { kind: 'eliminate-count', count: 12, label: '生産ラインの機体を12体破壊する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 6, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 5, 'hard')] },
        ],
        modifiers: ['dense-fog', 'no-regen'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '生産ラインから新造機が次々と出てくる。',
          '製造途中の機体を含めて破壊し、流れを止める。',
          '回復はない。被弾を抑えて削れ。',
        ],
        parTimeS: 130,
      },
      {
        id: 'c7m3-press-stealth',
        index: 2,
        title: 'プレス・ステルス',
        subtitle: '鍛圧潜行',
        objective: { kind: 'eliminate-count', count: 5, label: '鍛圧区の監視機5体を静かに排除する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 3, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 1, 'hard')] },
        ],
        modifiers: ['dense-fog', 'no-regen', 'one-life'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '鍛圧機が轟く区画は監視が薄い。',
          '騒音に紛れ、監視機だけを静かに抜く。',
          '被弾は即死に等しい。一度きりだ。',
        ],
        intel: ['ホムラ: プレスの作動音が足音を消す。リズムに合わせろ。'],
        parTimeS: 120,
      },
      {
        id: 'c7m4-core-hold',
        index: 3,
        title: 'コア・ホールド',
        subtitle: '炉心制圧',
        objective: { kind: 'defend', surviveS: 140, label: '炉心制御室を140秒死守する' },
        waves: [
          { trigger: 'start', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'timer', delayS: 45, enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
          { trigger: 'timer', delayS: 95, enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: ['dense-fog', 'no-regen'],
        difficulty: 'hard',
        durationS: 140,
        brief: [
          '炉心制御室を奪取した。解析が終わるまで守る。',
          '工廠の全戦力が奪還に殺到する。',
          '回復のない死地で、線を保て。',
        ],
        parTimeS: 140,
      },
      {
        id: 'c7m5-furnace-survival',
        index: 4,
        title: 'ファーネス・サバイバル',
        subtitle: '溶鉱炉防戦',
        objective: { kind: 'survive', surviveS: 165, label: '溶鉱炉区で165秒生き延びる' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 5, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 3, 'hard'), g('normal', 3, 'hard')] },
          { trigger: 'timer', delayS: 130, enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: ['dense-fog', 'no-regen'],
        difficulty: 'hard',
        durationS: 165,
        brief: [
          '溶鉱炉の熱と煙が渦巻く最深部。',
          '退路は溶けた鉄に塞がれた。',
          '回復なき地獄で、時間まで耐え抜け。',
        ],
        parTimeS: 150,
      },
      {
        id: 'c7m6-foundry-matron',
        index: 5,
        title: 'ファウンドリ・マトロン',
        subtitle: '工廠の母機',
        objective: { kind: 'assassinate', bossName: '工廠の母機', label: '製造中枢「工廠の母機」を撃破する' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('elite', 2, 'hard'), g('normal', 2, 'hard')],
            announce: '母機、防衛機を量産',
          },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'hard'), g('elite', 2, 'hard')],
            announce: '工廠の母機、起動',
          },
        ],
        modifiers: ['dense-fog', 'no-regen'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '工廠の製造を統べる巨大な母機。',
          '常に護衛を産み続ける。本体を最優先で削れ。',
          'これを潰せばCINDERの再生産は止まる。',
        ],
        cutscene: ['ホムラ: あれが地表側の生産核。残る本体は——軌道だ。'],
        parTimeS: 150,
      },
    ],
  ),
  // ─────────────────────────────── 第8章 ───────────────────────────────
  chapter(
    8,
    'neon',
    'kaede-ar',
    {
      title: '軌道の火種',
      subtitle: 'CINDERコア',
      lore: '軌道上のCINDERコアへ。低重力の中、これまでの全戦術が試される最終決戦。',
    },
    [
      {
        id: 'c8m1-low-g-breach',
        index: 0,
        title: 'ロウG・ブリーチ',
        subtitle: '軌道侵入',
        objective: { kind: 'eliminate-all', label: 'station外殻の守備機を全滅させる' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('normal', 4, 'hard')],
            announce: '低重力環境。軌道station外殻へ侵入',
          },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
        ],
        modifiers: ['low-gravity'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '軌道上のCINDERコアへ到達した。',
          '低重力で跳躍は伸び、落下は緩い。間合いが変わる。',
          'まず外殻の守備を制圧する。',
        ],
        cutscene: ['カゲロウ: ここが終点だ、ヒバナ。コアを焼き切れ。'],
        parTimeS: 130,
      },
      {
        id: 'c8m2-solar-array-hunt',
        index: 1,
        title: 'ソーラーアレイ・ハント',
        subtitle: '太陽帆掃討',
        objective: { kind: 'eliminate-count', count: 12, label: '太陽帆の防衛機を12体撃破する' },
        waves: [
          { trigger: 'start', enemies: [g('elite', 1, 'hard'), g('normal', 5, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: ['low-gravity'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '展開した太陽帆の上が次の戦場だ。',
          '低重力で敵も大きく跳ぶ。立体的に読め。',
          '帆の防衛機を狩り尽くせ。',
        ],
        parTimeS: 130,
      },
      {
        id: 'c8m3-airlock-escort',
        index: 2,
        title: 'エアロック・エスコート',
        subtitle: '隔壁突破',
        objective: { kind: 'extract', label: '与圧区を抜けて脱出地点へ到達する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: ['low-gravity'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '解析鍵を携え、与圧区を縦断する。',
          '隔壁が閉じる前に内殻の脱出地点へ。',
          '低重力の慣性を読んで跳べ。',
        ],
        parTimeS: 120,
      },
      {
        id: 'c8m4-reactor-hold',
        index: 3,
        title: 'リアクター・ホールド',
        subtitle: '炉室防衛',
        objective: { kind: 'defend', surviveS: 140, label: 'コア炉室を140秒死守する' },
        waves: [
          { trigger: 'start', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'timer', delayS: 45, enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
          { trigger: 'timer', delayS: 95, enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: ['low-gravity'],
        difficulty: 'hard',
        durationS: 140,
        brief: [
          'コアへ至る炉室を確保した。隔壁解除まで守る。',
          'CINDERは全防衛機を炉室へ差し向ける。',
          '低重力の死地で、線を保て。',
        ],
        parTimeS: 140,
      },
      {
        id: 'c8m5-gauntlet-survival',
        index: 4,
        title: 'ガントレット・サバイバル',
        subtitle: '最終回廊',
        objective: { kind: 'survive', surviveS: 180, label: '最終回廊で180秒生き延びる' },
        waves: [
          { trigger: 'start', enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 3, 'hard'), g('normal', 3, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 4, 'hard'), g('normal', 2, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 4, 'hard'), g('normal', 3, 'hard')] },
          { trigger: 'timer', delayS: 150, enemies: [g('elite', 3, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: ['low-gravity', 'elite-swarm'],
        difficulty: 'hard',
        durationS: 180,
        brief: [
          'コア直前の回廊は精鋭の濁流だ。',
          '低重力で四方八方から精鋭が跳び込む。',
          'これまでの全戦術を出し切り、生き延びろ。',
        ],
        parTimeS: 150,
      },
      {
        id: 'c8m6-cinder-core',
        index: 5,
        title: 'シンダー・コア',
        subtitle: '燼/CINDERコア',
        objective: { kind: 'assassinate', bossName: '燼/CINDERコア', label: 'CINDERコアを撃破する' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('elite', 3, 'hard'), g('normal', 2, 'hard')],
            announce: 'CINDER、最終防衛機を展開',
          },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'hard'), g('elite', 2, 'hard')],
            announce: 'CINDERコア、覚醒',
          },
        ],
        modifiers: ['low-gravity', 'one-life'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '自律戦術AI「CINDER」、その本体コア。',
          '低重力、護衛、そして一度の死も許されない卒業試験。',
          '世界を焼いた火種を、ここで消す。',
        ],
        cutscene: [
          'CINDER: 燃やすことだけが、最も効率的な解だった。',
          'ヒバナ: その解を、私が書き換える。',
          'カゲロウ: ……いけ、ヒバナ。終わらせろ。',
        ],
        parTimeS: 150,
      },
    ],
  ),
];

export function allMissions(): MissionDef[] {
  return CAMPAIGN.flatMap((c) => c.missions);
}
export function missionById(id: string): MissionDef | null {
  return allMissions().find((m) => m.id === id) ?? null;
}
export function firstMissionId(): string {
  return CAMPAIGN[0]!.missions[0]!.id;
}
export function nextMissionId(id: string): string | null {
  const all = allMissions();
  const i = all.findIndex((m) => m.id === id);
  return i >= 0 && i + 1 < all.length ? all[i + 1]!.id : null;
}
