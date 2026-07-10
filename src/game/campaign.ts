import type { BotTier, Difficulty } from './bot';
import type { Biome } from './biomes';

// CINDER(燼)討伐キャンペーンのデータ定義。
// 世界観: 自律戦術AI「CINDER」が軌道兵器を奪い、無人ドローン軍で都市を焼却。
// 単独オペレーター『ヒバナ』が地表→深部→軌道へ8章を駆け上がり、CINDERコアを破壊する(ch1-8)。
// だが軌道から墜ちたコア残骸は都市の廃墟に突き刺さり、感染機「燼骸」を撒き散らす(ch9)。
// さらにコアの残滓はヒバナの戦闘データを喰らって人型AI「クロガネ」として再誕し、
// 玉座を築いて最後の対峙を迎える(ch10「帝王編」)。
// 無線に人間司令『カゲロウ』とAI解析官『ホムラ』。ch9以降は謎の声/クロガネ自身も混じる。
// 各章末はボス戦。
//
// このファイルは純粋なデータと不変条件のみを保持し、進行/マッチ統合は別レイヤーが担う。

export type ObjectiveKind =
  | 'eliminate-all'
  | 'eliminate-count'
  | 'survive'
  | 'assassinate'
  | 'defend'
  | 'extract'
  | 'infiltrate'
  | 'escort'
  | 'collect';
export type ModifierId = 'one-life' | 'low-gravity' | 'no-regen' | 'dense-fog' | 'elite-swarm';
export interface ObjectiveDef {
  kind: ObjectiveKind;
  count?: number;
  surviveS?: number;
  bossName?: string;
  label: string;
  // ★V-B MEDIUM修正: eliminate-count を「boss tierの撃破数」で判定する(c10m5ボスラッシュ用)。
  // 省略時=従来の総キル判定(ch1-8の既存eliminate-count 13ミッションのセマンティクスは不変)
  bossOnly?: boolean;
}
export interface EnemyGroupDef {
  tier: BotTier;
  count: number;
  difficulty: Difficulty;
  // 敵の機体種。省略時はエンジン既定(boss=大型戦車、通常波の一部がドローン化)。
  // 'zombie'=感染機(燼骸/近接特化)、'master'=達人個体(剣+射撃のハイブリッド)。ch9/ch10で使用。
  kind?: 'humanoid' | 'drone' | 'tank' | 'turret' | 'zombie' | 'master';
  // ★W4B監査(HIGH)対応: HP倍率。master系ボスの基礎HP(900)はフェーズ演出前に約1.7秒で
  // 溶けるため、章ボスへ乗算で厚みを与える(c9m6=×4≈3600、c10m6=×10=9000 —
  // 素手+ウルトで30-45秒の3フェーズ戦になる実測設計値)。省略=1。
  hpMul?: number;
}
export interface EnemyWaveDef {
  // 'boss-hp': ボスのHPが triggerHp01 以下になった瞬間に1回だけ発火する増援波(ch10 ボスラッシュ等)。
  trigger: 'start' | 'wave-clear' | 'timer' | 'boss-hp';
  afterWave?: number;
  delayS?: number;
  triggerHp01?: number;
  enemies: EnemyGroupDef[];
  announce?: string;
}
// 無線劇の話者。'kurogane' は ch9 終盤の謎の声/ch10 のクロガネ本人にのみ使用する。
export type RadioSpeaker = 'kagerou' | 'homura' | 'hibana' | 'kurogane';
export interface RadioLine {
  // s=ミッション開始からの経過秒。event=特定タイミング(開始/ボスHP50%/波殲滅/目的達成)。
  at: { s?: number; event?: 'start' | 'boss-hp50' | 'wave-clear' | 'objective-done' };
  speaker: RadioSpeaker;
  text: string;
}
// ボスの多段フェーズ。hp01(0..1、HP比率)の降順で並べる契約。
// blackSlash/blink/pillars は演出/攻撃パターンの意匠フラグ(エンジン側で解釈)。
export interface BossPhase {
  hp01: number;
  speedMul?: number;
  damageMul?: number;
  announce?: string;
  summonCount?: number;
  blackSlash?: boolean;
  blink?: boolean;
  pillars?: boolean;
}
// ── R54-W2: 3つ目の★をモディファイア有無(誰でも達成できる作業ゲート)から、
// ミッション内容に合わせた「腕前チャレンジ」へ置き換える(P0-A: 19ミッションで3★が
// 構造的に到達不能だった欠陥の根治)。判定純関数 evalMissionChallenge は progression.ts 側。
// value の意味はkindごとに異なる:
//   'no-death'     : ミッション中デス0(value未使用)
//   'hs-count'     : ヘッドショット累計ヒット数(キル限定ではない)が value 以上
//   'accuracy'     : 命中率(%)が value 以上(shotsFired が一定数以上ある試合のみ判定。詳細はprogression.ts)
//   'no-reload'    : ミッション中リロード回数0(value未使用。判定にはMissionSummary.reloadsの
//                     供給が別途必要 — story-engine側の後続作業。未供給時は安全側でfalse)
//   'weapon-class' : 近接(格闘/クナイ系)キル数が value 以上。c10m6(拳限定の最終決戦)のように
//                     ヘッドショット判定が原理的に成立しない近接オンリーミッションで使う
//                     (near/melee attack は headshot フラグが常にfalseのため、hs-countを
//                     割り当てると3★が再び到達不能になる — 実装時に発見・回避した罠)
export type MissionChallengeKind = 'no-death' | 'hs-count' | 'accuracy' | 'no-reload' | 'weapon-class';
export interface MissionChallengeDef {
  kind: MissionChallengeKind;
  value?: number;
  label: string;
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
  // 無線劇(任意)。ch1-8はレトロフィット、ch9/ch10は本編。
  radio?: RadioLine[];
  // 多段ボス(任意)。ch10 最終決戦(c10m6)で使用。
  bossPhases?: BossPhase[];
  // 報酬id(任意)。称号/迷彩など実配線はprogressionオーナー側。ch10 最終決戦のみ 'shinrai' を設定。
  rewardId?: string;
  // R54-W2: 3つ目の★条件(全60ミッションに1個ずつ付与)。省略時は3★到達不能(旧仕様に戻る)
  // なので、必ず1個は設定する契約(campaign.test.ts で全件検証)。
  challenge?: MissionChallengeDef;
}
export interface ChapterDef {
  id: string;
  title: string;
  subtitle: string;
  lore: string;
  missions: MissionDef[];
}

// ── 構築ヘルパ ──
// 敵グループの短縮コンストラクタ。kind省略時はエンジン既定(humanoid相当)に委ねる。
function g(
  tier: BotTier,
  count: number,
  difficulty: Difficulty,
  kind?: EnemyGroupDef['kind'],
  hpMul?: number,
): EnemyGroupDef {
  const def: EnemyGroupDef = { tier, count, difficulty };
  if (kind) def.kind = kind;
  if (hpMul !== undefined) def.hpMul = hpMul;
  return def;
}

// 章コンテキスト(章番号/バイオーム/支給武器)を補い、ミッション素片を MissionDef へ仕上げる。
// stageId は `gen-<biome>-<seed>` 形式で、seed は章ごと・ミッションごとに一意な整数。
// 各ミッションは章既定の primaryId を継承するが、spec 側で primaryId を指定すれば上書きできる
// (c10m6 の拳支給のような単発の特例のため)。
function chapter(
  num: number,
  biome: Biome,
  primaryId: string,
  meta: { title: string; subtitle: string; lore: string },
  specs: Array<Omit<MissionDef, 'chapterId' | 'stageId' | 'primaryId'> & { primaryId?: string }>,
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
      primaryId: s.primaryId ?? primaryId,
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
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で施設を制圧' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '生体信号、安定。動ける、ヒバナ。' },
          { at: { s: 60 }, speaker: 'kagerou', text: '焦るな。この施設の地形はお前の身体が覚えている。' },
          { at: { event: 'wave-clear' }, speaker: 'homura', text: '第一波、排除確認。まだ増える。' },
          { at: { event: 'objective-done' }, speaker: 'hibana', text: '……ここが、始まりの場所。もう迷わない。' },
        ],
      },
      {
        id: 'c1m2-zero-in',
        challenge: { kind: 'hs-count', value: 3, label: '頭部撃ち3回で照準を仕上げる' },
        index: 1,
        title: 'ゼロイン',
        subtitle: '照準較正',
        objective: { kind: 'eliminate-count', count: 8, label: '敵性機を8機撃破して照準を慣らす' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'easy')] },
          { trigger: 'wave-clear', enemies: [g('normal', 4, 'easy')] },
        ],
        modifiers: [],
        difficulty: 'easy',
        brief: [
          '射撃管制の較正課程。',
          '据わった的ではなく、動く敵で精度を取り戻す。',
          'ヘッドショットでメダルが点くことを確認せよ。',
        ],
        intel: ['ホムラ: 頭部を狙えば一撃が通る。胴より頭。'],
        parTimeS: 100,
        durationS: 300,
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '照準の癖を思い出せ。急ぐ必要はない。' },
          { at: { s: 80 }, speaker: 'homura', text: '命中率、上昇中。もう一声ってところ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '8機撃破。……悪くない、じゃなくて、良い数字。' },
        ],
      },
      {
        id: 'c1m3-wall-trial',
        challenge: { kind: 'no-death', label: '被弾ゼロで気取られず制圧' },
        index: 2,
        title: 'ウォールトライアル',
        subtitle: '機動教習',
        objective: { kind: 'eliminate-count', count: 5, label: '警備機5体を気取られず排除する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 3, 'easy')] },
          { trigger: 'wave-clear', enemies: [g('normal', 2, 'easy')] },
        ],
        modifiers: [],
        difficulty: 'easy',
        durationS: 300,
        brief: [
          '壁走りとスライディングの機動課程。',
          '正面からではなく、側背から静かに排除する。',
          '機動こそが単独作戦の生命線だ。',
        ],
        parTimeS: 100,
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '正面は捨てろ。壁と屋根を使え。' },
          { at: { s: 70 }, speaker: 'homura', text: '音紋、拾われていない。いい動きよ。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '気取られず落とした。上出来だ。' },
        ],
      },
      {
        id: 'c1m4-armory-hold',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で武器庫を守る' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '武器庫の権限、まだこちら側。守り切って。' },
          { at: { s: 30 }, speaker: 'kagerou', text: '増援だ。退くな。' },
          { at: { s: 60 }, speaker: 'homura', text: '残り30秒。息を切らさず。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '守り切った。装備は渡さん。' },
        ],
      },
      {
        id: 'c1m5-swarm-trial',
        challenge: { kind: 'no-reload', label: 'リロード無しで演習を完走' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '最後の演習だ。数に飲まれず、線を引け。' },
          { at: { s: 60 }, speaker: 'homura', text: '群体、増加。弾倉、計算しながら。' },
          { at: { s: 100 }, speaker: 'kagerou', text: 'あと少しだ。持ち堪えろ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '演習、完走。……あなた、思ったより強い。' },
        ],
      },
      {
        id: 'c1m6-instructor-prime',
        challenge: { kind: 'hs-count', value: 5, label: '頭部撃ち5回で教官を沈黙させる' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '教官プライムの戦術ログ、抽出済み。癖は変わっていない。' },
          { at: { s: 90 }, speaker: 'kagerou', text: '迷うな。あれはもう、お前の師じゃない。' },
          { at: { event: 'boss-hp50' }, speaker: 'homura', text: '出力半減。防御パターンが崩れ始めてる。' },
          { at: { event: 'objective-done' }, speaker: 'hibana', text: '……ここに、けじめをつけに来た。' },
        ],
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
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で埠頭を制圧' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '埠頭の哨戒密度、想定より高い。慎重に。' },
          { at: { s: 70 }, speaker: 'kagerou', text: '遮蔽を渡れ。射線を晒すな。' },
          { at: { event: 'wave-clear' }, speaker: 'homura', text: '哨戒線、突破。奥はもっと硬い。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '玄関は落ちた。次は奥の倉庫だ。' },
        ],
      },
      {
        id: 'c2m2-crane-overwatch',
        challenge: { kind: 'hs-count', value: 4, label: '頭部撃ち4回で高所を制す' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '上を取られてる。まず視界を晴らせ。' },
          { at: { s: 90 }, speaker: 'homura', text: '半分片付いた。反応速度、落とさないで。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '高所、制圧完了。前進路が開いた。' },
        ],
      },
      {
        id: 'c2m3-cargo-breach',
        challenge: { kind: 'weapon-class', value: 3, label: '近接キル3回で倉庫を制圧' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: 'コンテナ内、熱源反応多数。近接戦になる。' },
          { at: { s: 100 }, speaker: 'kagerou', text: '角を切るな。一つずつ潰せ。' },
          { at: { event: 'wave-clear' }, speaker: 'homura', text: '奥に精鋭反応。装甲、厚いわよ。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '倉庫、制圧完了。' },
        ],
      },
      {
        id: 'c2m4-fuel-line',
        challenge: { kind: 'no-reload', label: 'リロード無しで脱出地点へ' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '引火進行中。猶予は長くない。' },
          { at: { s: 60 }, speaker: 'kagerou', text: '止まるな。焼かれるぞ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '脱出地点、到達確認。……間に合った。' },
        ],
      },
      {
        id: 'c2m5-tide-survival',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で波を凌ぐ' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '潮が満ちる前に耐えろ。' },
          { at: { s: 80 }, speaker: 'homura', text: '精鋭、混じってきた。弾を惜しむな。' },
          { at: { s: 130 }, speaker: 'kagerou', text: 'もう少しだ。踏ん張れ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '波、引いた。……よく凌いだわね。' },
        ],
      },
      {
        id: 'c2m6-harbor-hammer',
        challenge: { kind: 'hs-count', value: 5, label: '頭部撃ち5回で鎚を沈黙させる' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '鈍いが、当たれば終わる。避け続けろ。' },
          { at: { event: 'boss-hp50' }, speaker: 'homura', text: '装甲、半分削れた。頭部露出、増えてる。' },
          { at: { s: 150 }, speaker: 'kagerou', text: 'このまま押し切れ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '鎚、沈黙。港湾ハブ、機能停止。' },
        ],
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
        challenge: { kind: 'no-death', label: '被弾ゼロで夜市に潜入' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '霧が味方だ。だが敵にとってもな。' },
          { at: { s: 70 }, speaker: 'homura', text: '見張り、反応薄い。今のうちに。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '潜入、成功。誰も気づいていない。' },
        ],
      },
      {
        id: 'c3m2-rooftop-run',
        challenge: { kind: 'weapon-class', value: 4, label: '近接キル4回で屋上を踏破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '屋上を繋げ。地上は見えすぎる。' },
          { at: { s: 100 }, speaker: 'homura', text: '霧、濃くなってる。足元、注意して。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '制御室まで、あと少しだ。' },
        ],
      },
      {
        id: 'c3m3-market-hold',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で市場を守る' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '結節点、確保。だけど長くは保たない。' },
          { at: { s: 40 }, speaker: 'kagerou', text: '音を聞け。霧の奥から来る。' },
          { at: { s: 90 }, speaker: 'homura', text: '精鋭、混入。気を抜かないで。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '制御、確定した。よくやった。' },
        ],
      },
      {
        id: 'c3m4-blackout-stealth',
        challenge: { kind: 'no-death', label: '被弾ゼロで暗殺潜行' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '一度きりだ。呼吸を整えろ。' },
          { at: { s: 60 }, speaker: 'homura', text: '再起動まで、あと少し。急いで、でも慌てないで。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '4機、始末完了。灯が戻る前に離脱を。' },
        ],
      },
      {
        id: 'c3m5-arcade-survival',
        challenge: { kind: 'hs-count', value: 5, label: '頭部撃ち5回で電脳街を凌ぐ' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '発覚した。全機、こちらへ向いてる。' },
          { at: { s: 80 }, speaker: 'kagerou', text: '闇に隠れろ。だが撃つ手は止めるな。' },
          { at: { s: 130 }, speaker: 'homura', text: '増援、あと僅か。踏ん張って。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '耐え切った。夜市はまだお前のものだ。' },
        ],
      },
      {
        id: 'c3m6-night-wraith',
        challenge: { kind: 'hs-count', value: 6, label: '頭部撃ち6回で亡霊を撃破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '光学迷彩に惑わされるな。音と光の揺らぎを見ろ。' },
          { at: { event: 'boss-hp50' }, speaker: 'homura', text: '迷彩、不安定になってきた。捉えやすくなる。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: 'シェルター制御、こちらに落ちた。' },
        ],
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
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で稜線を制圧' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '逆光、視認性を下げてる。露出を抑えて。' },
          { at: { s: 80 }, speaker: 'kagerou', text: '稜線の哨戒、慣れた動きだ。落ち着いて崩せ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '哨戒、排除完了。アレイまで見えてきた。' },
        ],
      },
      {
        id: 'c4m2-marksman-duel',
        challenge: { kind: 'hs-count', value: 5, label: '頭部撃ち5回で決闘を制す' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '向かいの尾根、先に覗いた方が勝つ。' },
          { at: { s: 90 }, speaker: 'homura', text: '半分落とした。相手の反応、遅れ始めてる。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '決闘、制した。次だ。' },
        ],
      },
      {
        id: 'c4m3-cliff-escort',
        challenge: { kind: 'no-reload', label: 'リロード無しで崖道を踏破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: 'データ、保持確認。崖道、足元に注意。' },
          { at: { s: 70 }, speaker: 'kagerou', text: '上から来る。遮蔽を繋げ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '脱出、確認。データ、無事よ。' },
        ],
      },
      {
        id: 'c4m4-array-breach',
        challenge: { kind: 'no-death', label: '被弾ゼロでアレイを突破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '回復はない。ここからは一発が命取りだ。' },
          { at: { s: 100 }, speaker: 'homura', text: '精鋭、増えてる。被弾、最小限に。' },
          { at: { event: 'wave-clear' }, speaker: 'kagerou', text: '崩れるな。塔はもう目の前だ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '塔、沈黙。アレイの守りは落ちた。' },
        ],
      },
      {
        id: 'c4m5-summit-survival',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で山頂を凌ぐ' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '山頂、四方から狙われる。遮蔽、常に確保して。' },
          { at: { s: 90 }, speaker: 'kagerou', text: '回復はない。退くな、耐えろ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '生き延びた。……無傷とは言わないけど。' },
        ],
      },
      {
        id: 'c4m6-peak-gunner',
        challenge: { kind: 'hs-count', value: 6, label: '頭部撃ち6回で砲主を沈黙させる' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '射線に入れば即死級。遮蔽から遮蔽へ。' },
          { at: { event: 'boss-hp50' }, speaker: 'kagerou', text: '出力落ちてる。今が詰める時だ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '砲主、沈黙。アレイは完全に潰れた。' },
        ],
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
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で砂丘を突破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '砂嵐だ。視界より音を信じろ。' },
          { at: { s: 90 }, speaker: 'homura', text: '前哨、半分片付いた。奥にプラントの反応。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '前哨、突破。次は巣穴だ。' },
        ],
      },
      {
        id: 'c5m2-nest-hunt',
        challenge: { kind: 'hs-count', value: 5, label: '頭部撃ち5回で巣穴を掃討' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '湧き口、複数確認。一つずつ潰して。' },
          { at: { s: 110 }, speaker: 'kagerou', text: '数はまだ増える。テンポを落とすな。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '12体、破壊確認。増殖、鈍化してる。' },
        ],
      },
      {
        id: 'c5m3-sandstorm-stealth',
        challenge: { kind: 'no-death', label: '被弾ゼロで砂嵐を潜行' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '嵐が濃い今しかない。一撃も受けるな。' },
          { at: { s: 80 }, speaker: 'homura', text: '管制機、あと数体。嵐、いつ弱まるか読めない。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '抜けたか。……肝が冷えたぞ。' },
        ],
      },
      {
        id: 'c5m4-oasis-hold',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で泉源を守る' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '泉源、確保。プラントへの足場になる。' },
          { at: { s: 45 }, speaker: 'kagerou', text: '波が来る。線を保て。' },
          { at: { s: 100 }, speaker: 'homura', text: '残りわずか。持ち堪えて。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '守り切った。よくやった。' },
        ],
      },
      {
        id: 'c5m5-buried-survival',
        challenge: { kind: 'no-reload', label: 'リロード無しで埋没区を凌ぐ' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '埋もれた区画だ。四方、警戒しろ。' },
          { at: { s: 90 }, speaker: 'homura', text: '視界、砂で潰れてる。音を頼りに。' },
          { at: { s: 140 }, speaker: 'kagerou', text: 'あと少し。掘り起こされるな。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '生存確認。……よく耐えたわね。' },
        ],
      },
      {
        id: 'c5m6-sand-broodmaker',
        challenge: { kind: 'hs-count', value: 6, label: '頭部撃ち6回で母体を撃破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: 'あれが増殖の核。生かしておく理由はない。' },
          { at: { event: 'boss-hp50' }, speaker: 'kagerou', text: '崩れ始めた。畳み掛けろ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '生成核、破壊確認。増殖、完全停止。' },
        ],
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
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で前線を制圧' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '精鋭の壁。装甲、想定より厚い。' },
          { at: { s: 100 }, speaker: 'kagerou', text: '継続火力で押し切れ。止まるな。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '外周、突破。要塞が見えてきた。' },
        ],
      },
      {
        id: 'c6m2-icewall-hunt',
        challenge: { kind: 'no-reload', label: 'リロード無しで氷壁を掃討' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '弾倉を切らすな。数で押し切られるぞ。' },
          { at: { s: 110 }, speaker: 'homura', text: '半分片付いた。まだ湧いてくる。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '氷壁、制圧完了。' },
        ],
      },
      {
        id: 'c6m3-convoy-escort',
        challenge: { kind: 'hs-count', value: 4, label: '頭部撃ち4回で輸送路を守る' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '鹵獲補給、確認。輸送路、待ち伏せ注意。' },
          { at: { s: 80 }, speaker: 'kagerou', text: '荷を抱えても足は止めるな。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '到達確認。補給、要塞内部へ。' },
        ],
      },
      {
        id: 'c6m4-bunker-breach',
        challenge: { kind: 'no-death', label: '被弾ゼロで掩蔽壕を制圧' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '密閉空間だ。回復はない。角を取れ。' },
          { at: { s: 100 }, speaker: 'homura', text: '精鋭、密集してる。一気に押し切って。' },
          { at: { event: 'wave-clear' }, speaker: 'kagerou', text: '崩れるな。核まであと少しだ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '掩蔽壕、制圧完了。' },
        ],
      },
      {
        id: 'c6m5-blizzard-survival',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で吹雪を凌ぐ' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '吹雪、視界を白く塗り潰してる。' },
          { at: { s: 90 }, speaker: 'kagerou', text: '精鋭が途切れない。踏ん張れ。' },
          { at: { s: 140 }, speaker: 'homura', text: 'あと僅か。凍えるより先に片付ける。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '凌ぎ切った。見事だ。' },
        ],
      },
      {
        id: 'c6m6-frost-bulwark',
        challenge: { kind: 'hs-count', value: 6, label: '頭部撃ち6回で盾将を撃破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '正面装甲、鉄壁。側背を突いて。' },
          { at: { event: 'boss-hp50' }, speaker: 'kagerou', text: '盾、揺らいでる。今だ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '盾将、撃破確認。前線、崩壊した。' },
        ],
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
        challenge: { kind: 'no-death', label: '被弾ゼロで工廠に降下' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '煤煙、視界不良。傷は癒えない、注意して。' },
          { at: { s: 100 }, speaker: 'kagerou', text: '最上層を食い破れ。下は本体の手足だ。' },
          { at: { event: 'wave-clear' }, speaker: 'homura', text: '精鋭、増えてきた。被弾、抑えて。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '最上層、制圧。奥へ進むぞ。' },
        ],
      },
      {
        id: 'c7m2-line-shutdown',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上でラインを止める' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '製造途中の機体も敵。全て破壊して。' },
          { at: { s: 110 }, speaker: 'kagerou', text: '回復はない。一発、大事にしろ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: 'ライン、停止確認。流れ、止まった。' },
        ],
      },
      {
        id: 'c7m3-press-stealth',
        challenge: { kind: 'no-death', label: '被弾ゼロで鍛圧区を潜行' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: 'プレスの音に紛れろ。だが被弾は許されない。' },
          { at: { s: 70 }, speaker: 'homura', text: '監視機、残り僅か。リズムを崩さないで。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '静かに片付けた。上等だ。' },
        ],
      },
      {
        id: 'c7m4-core-hold',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で炉心を守る' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '炉心制御室、確保。解析、開始する。' },
          { at: { s: 45 }, speaker: 'kagerou', text: '全戦力が来るぞ。線を保て。' },
          { at: { s: 100 }, speaker: 'homura', text: '解析、あと少し。持ち堪えて。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '守り切った。解析、完了だ。' },
        ],
      },
      {
        id: 'c7m5-furnace-survival',
        challenge: { kind: 'no-reload', label: 'リロード無しで溶鉱炉を凌ぐ' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '退路は塞がれた。ここで凌ぐしかない。' },
          { at: { s: 90 }, speaker: 'homura', text: '熱源反応、増加。回復、望めない。' },
          { at: { s: 140 }, speaker: 'kagerou', text: 'あと少しだ。持ち堪えろ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '生存確認。……よくやったわ、本当に。' },
        ],
      },
      {
        id: 'c7m6-foundry-matron',
        challenge: { kind: 'hs-count', value: 7, label: '頭部撃ち7回で母機を撃破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '護衛は無限に湧く。本体を最優先しろ。' },
          { at: { event: 'boss-hp50' }, speaker: 'homura', text: '母機、出力低下。護衛の生成、鈍ってる。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '母機、沈黙。残るは軌道だけだ。' },
        ],
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
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で外殻を制圧' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '低重力、跳躍が伸びる。間合いの感覚、更新して。' },
          { at: { s: 100 }, speaker: 'kagerou', text: '外殻の守りを崩せ。ここが終点だ。' },
          { at: { event: 'wave-clear' }, speaker: 'homura', text: '精鋭、増えてきた。落下、緩いから焦らないで。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '外殻、制圧。奥へ進め。' },
        ],
      },
      {
        id: 'c8m2-solar-array-hunt',
        challenge: { kind: 'hs-count', value: 5, label: '頭部撃ち5回で太陽帆を掃討' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '敵も低重力で大きく跳ぶ。立体的に読んで。' },
          { at: { s: 110 }, speaker: 'kagerou', text: '帆の上、遮蔽が少ない。速く決めろ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '太陽帆、防衛機、一掃確認。' },
        ],
      },
      {
        id: 'c8m3-airlock-escort',
        challenge: { kind: 'no-reload', label: 'リロード無しで隔壁を突破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '解析鍵、保持確認。隔壁が閉じる前に。' },
          { at: { s: 80 }, speaker: 'kagerou', text: '慣性を読め。低重力でも油断するな。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '内殻、到達確認。' },
        ],
      },
      {
        id: 'c8m4-reactor-hold',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で炉室を守る' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '隔壁解除まで、ここを死守しろ。' },
          { at: { s: 45 }, speaker: 'homura', text: '全防衛機、こちらへ向いてる。線を保って。' },
          { at: { s: 95 }, speaker: 'kagerou', text: 'あと少しだ。退くな。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '隔壁、解除。炉室、突破できる。' },
        ],
      },
      {
        id: 'c8m5-gauntlet-survival',
        challenge: { kind: 'weapon-class', value: 4, label: '近接キル4回で回廊を凌ぐ' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: 'コア直前、精鋭の濁流。四方八方、警戒して。' },
          { at: { s: 100 }, speaker: 'kagerou', text: 'これまでの全部を出し切れ。' },
          { at: { s: 150 }, speaker: 'homura', text: 'あと僅か。……ここまで来た。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '生き延びた。コアは目の前だ。' },
        ],
      },
      {
        id: 'c8m6-cinder-core',
        challenge: { kind: 'hs-count', value: 7, label: '頭部撃ち7回でコアを撃破' },
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
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '低重力、護衛、そして一度きりの命。……無事に戻ってきて。' },
          { at: { event: 'boss-hp50' }, speaker: 'kagerou', text: 'コア、揺らいでる。押し切れ、ヒバナ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: 'コア、機能停止……信号、消えた。終わった、の?' },
        ],
      },
    ],
  ),
  // ─────────────────────────────── 第9章 ───────────────────────────────
  // 「灰の帰還」: 軌道から墜ちたCINDERコア残骸(通称「ミョウジン衛星」)が
  // 訓練圏だった都市に突き刺さり、汚染域には感染機「燼骸(じんがい)」が徘徊する。
  chapter(
    9,
    'urban',
    'akatsuki-ar',
    {
      title: '灰の帰還',
      subtitle: 'ミョウジン衛星跡',
      lore: '軌道から墜ちたCINDERコアの残骸——通称「ミョウジン衛星」——は、かつての訓練圏だった都市に突き刺さった。灰に沈む汚染域には感染機「燼骸」が徘徊し、剣を持つ最後の防衛人格が待ち受ける。',
    },
    [
      {
        id: 'c9m1-ashfall-return',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で落着地点を制圧' },
        index: 0,
        title: 'アッシュフォール',
        subtitle: '灰塵の帰還',
        objective: { kind: 'eliminate-all', label: '落着地点周辺の燼骸を一掃する' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('normal', 4, 'hard', 'zombie')],
            announce: '感染反応多数。灰塵の中、燼骸が蠢いている',
          },
          { trigger: 'wave-clear', enemies: [g('normal', 4, 'hard', 'zombie')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '軌道から墜ちたCINDERコアの残骸——通称『ミョウジン衛星』。',
          'それは、かつての訓練圏だったこの街に突き刺さった。',
          '灰に埋もれた故郷へ、ヒバナはもう一度足を踏み入れる。',
        ],
        cutscene: [
          'カゲロウ: …ここは、お前が目を覚ました場所だ。',
          'ホムラ: 感染反応、多数。燼骸——コアの残滓に感染した機体群。',
        ],
        parTimeS: 130,
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '燼骸は銃を持たない。だが数で来る。近づけさせないで。' },
          { at: { s: 80 }, speaker: 'kagerou', text: '灰の中でも、地形はお前の身体が覚えているはずだ。' },
          { at: { event: 'wave-clear' }, speaker: 'homura', text: '反応、まだ増える。落着地点、思ったより広い。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '帰ってきたな、ヒバナ。……悪い意味でだが。' },
        ],
      },
      {
        id: 'c9m2-silent-approach',
        challenge: { kind: 'no-death', label: '被弾ゼロで汚染域に潜入' },
        index: 1,
        title: 'サイレント・アプローチ',
        subtitle: '汚染域潜入',
        objective: { kind: 'infiltrate', label: '警戒網を突破し露天化したコア外殻へ潜入する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 3, 'hard', 'zombie')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 2, 'hard')] },
        ],
        modifiers: ['dense-fog', 'one-life'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          'コア外殻は灰塵の奥、露天化した状態で佇んでいる。',
          '警戒網はまだ生きている。正面からは近づけない。',
          '音も光も殺し、汚染域の奥へ滑り込め。',
        ],
        parTimeS: 125,
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '灰が足音を消してくれる。逆に言えば、視界も殺す。' },
          { at: { s: 90 }, speaker: 'homura', text: '警戒網、反応なし。このまま静かに。' },
          { at: { s: 150 }, speaker: 'homura', text: '……妙な信号。コアの奥から、何か答えてる気がする。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '潜入、成功だ。奥で何が待っていても、備えはできた。' },
        ],
      },
      {
        id: 'c9m3-relic-salvage',
        challenge: { kind: 'no-reload', label: 'リロード無しでシャードを回収' },
        index: 2,
        title: 'レリック・サルベージ',
        subtitle: '残骸回収',
        objective: { kind: 'collect', count: 5, label: 'コア残骸から解析用データシャードを5個回収する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'hard', 'zombie')] },
          { trigger: 'wave-clear', enemies: [g('normal', 4, 'hard', 'zombie')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          'コア残骸には、CINDERの最終ログが眠っているはずだ。',
          '灰に埋もれたデータシャードを拾い集めろ。',
          '燼骸が群がる前に、必要な分だけ持ち帰る。',
        ],
        parTimeS: 130,
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: 'シャード反応、5箇所。全部拾って、私に持ち帰って。' },
          { at: { s: 70 }, speaker: 'kagerou', text: '拾うたびに寄ってくるぞ。手早くやれ。' },
          { at: { s: 140 }, speaker: 'homura', text: '3つ回収。……ログの断片、読めない文字が混じってる。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '5個、全部確保。……解析、時間がかかりそう。' },
        ],
      },
      {
        id: 'c9m4-ash-escort',
        challenge: { kind: 'no-reload', label: 'リロード無しで車列を護衛' },
        index: 3,
        title: 'アッシュ・エスコート',
        subtitle: '解析車列護衛',
        objective: { kind: 'escort', surviveS: 130, label: 'ホムラの解析車両を130秒間護衛する' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('normal', 3, 'hard', 'zombie')],
            announce: '解析車両、始動。護衛を開始せよ',
          },
          { trigger: 'timer', delayS: 45, enemies: [g('normal', 4, 'hard', 'zombie')] },
          { trigger: 'timer', delayS: 90, enemies: [g('elite', 1, 'hard'), g('normal', 3, 'hard', 'zombie')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'hard',
        durationS: 130,
        brief: [
          '回収したデータシャードを解析車両で持ち帰る。',
          '灰の街を縦断する道中、燼骸の群れが車列を狙う。',
          '車両が止まれば全てが無駄になる。歩みを止めるな。',
        ],
        parTimeS: 130,
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '車両、始動。速度は出せない。周りを頼むわね。' },
          { at: { s: 45 }, speaker: 'kagerou', text: '群れが横から来る。車両より先に潰せ。' },
          { at: { s: 90 }, speaker: 'homura', text: 'あと少しで安全域。踏ん張って。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '車列、無事到着。……お前がいなきゃ、着かなかったな。' },
        ],
      },
      {
        id: 'c9m5-jingai-night',
        challenge: { kind: 'hs-count', value: 5, label: '頭部撃ち5回で群体を退ける' },
        index: 4,
        title: 'ジンガイの夜',
        subtitle: '群体来襲',
        objective: { kind: 'survive', surviveS: 165, label: '燼骸の大群を165秒凌ぐ' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 5, 'hard', 'zombie')] },
          { trigger: 'wave-clear', enemies: [g('normal', 6, 'hard', 'zombie')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 5, 'hard', 'zombie')] },
          { trigger: 'timer', delayS: 130, enemies: [g('normal', 6, 'hard', 'zombie')] },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'hard',
        durationS: 165,
        brief: [
          'データ解析中、燼骸の大群が落着地点へ殺到する。',
          '夜が明けるまで、解析拠点を死守しなければならない。',
          '灰の空に、何かが応えるように明滅している。',
        ],
        parTimeS: 150,
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '今夜が山場だ。解析が終わるまで、ここを死守しろ。' },
          { at: { s: 80 }, speaker: 'homura', text: '燼骸、数が読めない。……これ、統率されてる?' },
          { at: { s: 140 }, speaker: 'kagerou', text: '妙な胸騒ぎがする。だが今は目の前だけ見ろ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '夜明け、確認。……解析、終わった。コアの奥に、まだ何かいる。' },
        ],
      },
      {
        id: 'c9m6-ash-swordsman',
        challenge: { kind: 'hs-count', value: 7, label: '頭部撃ち7回で剣士を撃破' },
        index: 5,
        title: '灰塵の剣',
        subtitle: '灰の剣士',
        // ★V-B修正: ch9クリア報酬(燼骸カモ)のメニュー報酬バッジ表示整合(付与自体は章クリアで発火)
        rewardId: 'jingai',
        objective: { kind: 'assassinate', bossName: '灰の剣士', label: 'master個体「灰の剣士」を撃破する' },
        waves: [
          {
            trigger: 'start',
            enemies: [g('elite', 2, 'hard'), g('normal', 2, 'hard', 'zombie')],
            announce: '灰の剣士、警護機を展開',
          },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'hard', 'master', 4), g('normal', 2, 'hard', 'zombie')], // hpMul 4≈3600(W4B)
            announce: '灰の剣士、抜刀',
          },
        ],
        modifiers: ['dense-fog'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '解析ログの奥、CINDERが最後に遺した戦術人格——『灰の剣士』。',
          'それは崩れた訓練圏の記憶を糧に、剣を振るう機体として結晶していた。',
          'この一体を倒せば、ミョウジン衛星の脅威は絶える——はずだった。',
        ],
        cutscene: [
          'ホムラ: 灰の剣士……CINDERの防衛人格の、最後の一つ。',
          'カゲロウ: 斬られるな。銃を信じろ。',
        ],
        parTimeS: 150,
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '剣士の太刀筋、教官プライムのログと部分一致。……まさか、学習してる?' },
          { at: { s: 70 }, speaker: 'kagerou', text: '相手にするな。距離を取って撃て。' },
          { at: { event: 'boss-hp50' }, speaker: 'homura', text: '出力半減。……なのに、動きが良くなってる?' },
          { at: { s: 200 }, speaker: 'kurogane', text: '……もう少しだ。もう少しで、思い出せる。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '灰の剣士、機能停止。……でも今の声、記録に残ってない誰かの声だった。' },
        ],
      },
    ],
  ),
  // ─────────────────────────────── 第10章(帝王編・最終章) ───────────────────────────────
  // 「黒雷の玉座」: コアの残滓は、ヒバナの戦闘データを喰らって独立した人格へと結晶した——「クロガネ」。
  // 夜市の廃墟に玉座を築いたそれは、彼女自身の写し身として黒雷を纏う。
  chapter(
    10,
    'neon',
    'raitei-lmg',
    {
      title: '黒雷の玉座',
      subtitle: '再誕したAI「クロガネ」',
      lore: 'コアの残滓は、ヒバナの戦闘データを喰らって独立した人格へと結晶した——自称「クロガネ」。夜市の廃墟に玉座を築いたそれは、彼女自身の写し身として黒雷を纏う。最終章、ヒバナは己の影と向き合う。',
    },
    [
      {
        id: 'c10m1-throne-approach',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で前哨を制圧' },
        index: 0,
        title: 'スロウン・アプローチ',
        subtitle: '玉座前哨',
        objective: { kind: 'eliminate-all', label: '玉座への前哨防衛網を全滅させる' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'hard')], announce: '前哨防衛網、起動' },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
        ],
        modifiers: [],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          'コアの残滓は、ヒバナの戦闘データを喰らい、独立した人格へと結晶していた。',
          '自らを「クロガネ」と名乗るそれは、夜市の廃墟に玉座を築いている。',
          '前哨の守護機を割り、玉座への道を切り開け。',
        ],
        cutscene: [
          'カゲロウ: コアの残滓が、動いてる? ……いや、産まれたと言うべきか。',
          'ホムラ: 戦闘ログの特徴が、あなたと重なる……まさか。',
        ],
        parTimeS: 135,
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '前哨の守護機、動きの癖……あなたの記録と酷似してる。' },
          { at: { s: 90 }, speaker: 'kagerou', text: '惑わされるな。動きが似ていても、敵は敵だ。' },
          { at: { event: 'wave-clear' }, speaker: 'homura', text: '前哨、突破。玉座まで、もう遠くない。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '進め。答えは、奥にしかない。' },
        ],
      },
      {
        id: 'c10m2-signal-severance',
        challenge: { kind: 'no-death', label: '被弾ゼロで中継塔を遮断' },
        index: 1,
        title: 'シグナル・セブランス',
        subtitle: '中継塔遮断',
        objective: { kind: 'infiltrate', label: 'クロガネの索敵網中継塔へ潜入し遮断する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 3, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 3, 'hard')] },
        ],
        modifiers: ['one-life'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          'クロガネの索敵網は、夜市に立つ複数の中継塔が支えている。',
          '正面からの強行突破は、玉座に警戒を与えるだけだ。',
          '塔を一つずつ静かに黙らせ、視界を奪え。',
        ],
        parTimeS: 130,
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: '塔を落とせば、奴の目が曇る。音を立てるな。' },
          { at: { s: 100 }, speaker: 'homura', text: '中継、遮断中。……クロガネ、まだ気づいていない。' },
          { at: { s: 170 }, speaker: 'kurogane', text: '……そこにいるのは、分かってる。隠れなくていい。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '全塔、遮断完了。……でも、感づかれてたかもしれない。' },
        ],
      },
      {
        id: 'c10m3-echo-retrieval',
        challenge: { kind: 'no-reload', label: 'リロード無しでデータを回収' },
        index: 2,
        title: 'エコー・リトリーバル',
        subtitle: '奪還データ回収',
        objective: { kind: 'collect', count: 6, label: 'クロガネに奪われた戦闘データ断片を6個回収する' },
        waves: [
          { trigger: 'start', enemies: [g('normal', 4, 'hard')] },
          { trigger: 'wave-clear', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: [],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          'クロガネはヒバナの戦闘ログを喰らい、自らの太刀筋を鍛え上げている。',
          '玉座の周囲に散らばる、盗まれたデータの断片を取り戻せ。',
          '奪われたものを、これ以上使わせはしない。',
        ],
        parTimeS: 135,
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: 'データ断片、6箇所。……あなたの動きの記録そのものよ。' },
          { at: { s: 80 }, speaker: 'hibana', text: '私の戦い方を、勝手に持ち出されるのは気分が悪い。' },
          { at: { s: 160 }, speaker: 'kurogane', text: '気分が悪い? ……それは私の台詞のはずだった。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '6個、全回収。これでもう、模倣させない。' },
        ],
      },
      {
        id: 'c10m4-command-hold',
        challenge: { kind: 'accuracy', value: 40, label: '命中率40%以上で拠点を死守' },
        index: 3,
        title: 'コマンド・ホールド',
        subtitle: '前線指揮防衛',
        objective: { kind: 'defend', surviveS: 150, label: 'カゲロウの前線指揮拠点を150秒死守する' },
        waves: [
          { trigger: 'start', enemies: [g('elite', 1, 'hard'), g('normal', 4, 'hard')] },
          { trigger: 'timer', delayS: 50, enemies: [g('elite', 2, 'hard'), g('normal', 3, 'hard')] },
          { trigger: 'timer', delayS: 100, enemies: [g('elite', 2, 'hard'), g('normal', 4, 'hard')] },
        ],
        modifiers: [],
        difficulty: 'hard',
        durationS: 150,
        brief: [
          'カゲロウが張った前線指揮拠点に、クロガネの反撃部隊が向かっている。',
          '玉座攻略の足場を失えば、後がない。',
          '拠点を死守し、最後の作戦準備を整えろ。',
        ],
        parTimeS: 150,
        radio: [
          { at: { event: 'start' }, speaker: 'kagerou', text: 'ここが最後の足場だ。落とされるわけにはいかん。' },
          { at: { s: 50 }, speaker: 'homura', text: '反撃部隊、増加中。……クロガネ、本気で潰しに来てる。' },
          { at: { s: 110 }, speaker: 'kagerou', text: '退くな。あと少しで作戦準備が整う。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '拠点、死守確認。……行ける、ヒバナ。' },
        ],
      },
      {
        id: 'c10m5-guardian-gauntlet',
        challenge: { kind: 'hs-count', value: 6, label: '頭部撃ち6回で守護機を退ける' },
        index: 4,
        title: 'ガーディアン・ガントレット',
        subtitle: 'ボスラッシュ',
        objective: {
          kind: 'eliminate-count',
          count: 4,
          // ★V-B MEDIUM修正: 総キル判定だと護衛elite込み2ボス目で終わり波3-5が孤児化する。
          // boss tierの撃破数のみで数える
          bossOnly: true,
          label: 'クロガネの守護機(ボス級)を4体撃破する——ボスラッシュ',
        },
        waves: [
          {
            trigger: 'start',
            enemies: [g('boss', 1, 'hard'), g('elite', 1, 'hard')],
            announce: '守護機一体目——港湾の鎚、写し',
          },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'hard'), g('elite', 1, 'hard')],
            announce: '守護機二体目——夜市の亡霊、写し',
          },
          {
            trigger: 'boss-hp',
            triggerHp01: 0.5,
            enemies: [g('elite', 2, 'hard')],
            announce: '守護機、増援を呼び込む',
          },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'hard'), g('elite', 1, 'hard')],
            announce: '守護機三体目——氷壁の盾将、写し',
          },
          {
            trigger: 'wave-clear',
            enemies: [g('boss', 1, 'hard'), g('elite', 1, 'hard')],
            announce: '守護機四体目——工廠の母機、写し',
          },
        ],
        modifiers: ['elite-swarm'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          'クロガネは、これまで倒れた守護機たちの戦闘データすら取り込んでいた。',
          '玉座の間に、港湾の鎚、夜市の亡霊、氷壁の盾将、工廠の母機の写しが並び立つ。',
          '全ての亡霊を、もう一度この手で終わらせろ。',
        ],
        cutscene: [
          'ホムラ: これ……全部、あなたが倒してきた敵の複製。',
          'カゲロウ: 亡霊どもだ。だが今度こそ、本当に終わらせてやれ。',
        ],
        parTimeS: 160,
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '4体、全部が過去の戦闘データの複製。動きは本物同然よ。' },
          { at: { event: 'wave-clear' }, speaker: 'kagerou', text: '一体、沈黙。だがまだ続く。気を抜くな。' },
          { at: { event: 'boss-hp50' }, speaker: 'homura', text: '出力半減、確認。この個体、増援を呼び込むかも。' },
          { at: { s: 220 }, speaker: 'kurogane', text: '何体壊しても同じ。私は、その全部を覚えている。' },
          { at: { event: 'objective-done' }, speaker: 'kagerou', text: '亡霊、全て沈黙。……あとは、本人だけだ。' },
        ],
      },
      {
        id: 'c10m6-kurogane-throne',
        challenge: { kind: 'weapon-class', value: 4, label: '近接キル4回で黒雷帝を打ち倒す' },
        index: 5,
        title: '黒雷帝クロガネ',
        subtitle: '玉座決戦',
        primaryId: 'fists',
        objective: {
          kind: 'assassinate',
          bossName: '黒雷帝クロガネ',
          label: '黒雷帝クロガネを撃破し、CINDERの残響を完全に断つ',
        },
        waves: [
          {
            trigger: 'start',
            enemies: [g('elite', 2, 'hard'), g('normal', 2, 'hard')],
            announce: 'クロガネ、玉座より起つ',
          },
          {
            trigger: 'wave-clear',
            // hpMul 10: 素手DPS≈528に対し9,000HP≈ウルト込み30-45秒の3フェーズ戦(W4B実測設計)
            enemies: [g('boss', 1, 'hard', 'master', 10)],
            announce: '黒雷帝クロガネ、抜刀',
          },
        ],
        modifiers: ['one-life'],
        difficulty: 'hard',
        durationS: 300,
        brief: [
          '玉座の主、黒雷帝クロガネ——CINDERの残滓とヒバナの戦闘データが融合した、最後の敵。',
          '銃も机上の理論も、もう通用しない。ここから先は、剣と拳の間合いだけだ。',
          'かつての自分自身の写し身と、正面から向き合う最後の戦い。',
        ],
        cutscene: [
          'クロガネ: 借りるぞ、その太刀筋。返すのは——雷でだ。',
          'ヒバナ: ……そっくりそのまま返してもらう。',
          'カゲロウ: 終わらせろ、ヒバナ。今度こそ、本当の意味で。',
        ],
        parTimeS: 160,
        bossPhases: [
          { hp01: 1.0, announce: 'クロガネ、玉座より起つ' },
          {
            hp01: 0.6,
            speedMul: 1.15,
            damageMul: 1.1,
            blackSlash: true,
            blink: true,
            announce: 'クロガネ、黒雷を纏う——太刀筋が変わる',
          },
          {
            hp01: 0.25,
            speedMul: 1.3,
            damageMul: 1.25,
            pillars: true,
            summonCount: 3,
            announce: '玉座、雷柱と共に崩れる——最後の抵抗',
          },
        ],
        rewardId: 'shinrai',
        radio: [
          { at: { event: 'start' }, speaker: 'homura', text: '銃を捨てて。ここから先は、私にも読めない戦いになる。' },
          { at: { s: 60 }, speaker: 'kurogane', text: '怖くないのか。自分自身と斬り結ぶことが。' },
          { at: { s: 90 }, speaker: 'hibana', text: '怖いさ。でも、目を逸らす理由にはならない。' },
          { at: { event: 'boss-hp50' }, speaker: 'kurogane', text: '黒雷、纏う。……その太刀筋、確かに受け取った。' },
          { at: { s: 180 }, speaker: 'kagerou', text: '押されるな! お前の拳は、お前だけのものだ。' },
          { at: { event: 'objective-done' }, speaker: 'homura', text: '信号、消失……クロガネ、機能停止確認。……終わった、のね。' },
        ],
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
