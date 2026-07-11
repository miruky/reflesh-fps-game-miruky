// R58: 武器シルエット/ディテールの型(旧 viewmodel.ts から移設。単一オーナー=Phase C衝突防止)。
// viewmodel.ts は index.ts 経由でこれらを再export し、既存の import 互換を保つ。
// 新フィールド(15)は全て optional=後方互換。未設定なら resolveDetail/buildGunBody は従来挙動
// (=視覚不変)。enum 拡張(stock/barrelProfile/receiverStyle)は buildGunBody 側の switch/if へ
// 最小 case を足す(Phase B)。実ジオメトリは Phase C の painter が描く。

// 頂点カラーの陰影モード。flat=均一、gradY=下暗上明の擬似AO、
// machined=削り出し鋼(急勾配+稜線ベベル)、edgeHi=研磨リム(上端を二次で光らせる)。
export type ShadeMode = 'flat' | 'gradY' | 'machined' | 'edgeHi';

// 給弾方式。mag-curved/straight=着脱式弾倉、drum=ドラム、box=箱型、belt=ベルト給弾、
// tube=チューブ弾倉(+フォアエンド)、horizontal=横置き弾倉(P90系)、none=なし
export type FeedKind =
  | 'mag-curved'
  | 'mag-straight'
  | 'drum'
  | 'box'
  | 'belt'
  | 'tube'
  | 'horizontal'
  | 'none';
// ハンドガード形状。slim=細身、rail=レール付き、wood=木製、shroud=バレルシュラウド
export type HandguardKind = 'none' | 'slim' | 'rail' | 'wood' | 'shroud' | 'vented';
// ストック形状。fixed=固定、skeleton=スケルトン、folding=折りたたみ。
// R58 拡張: wire=ワイヤー枠(PM12/Uzi)、thumbhole=サムホール(SVD)、wood=木製固定(FAL/SVD)。
export type StockKind = 'none' | 'fixed' | 'skeleton' | 'folding' | 'wire' | 'thumbhole' | 'wood';
// マズルデバイス。brake=マズルブレーキ、flash=フラッシュハイダー、shroud=覆い
export type MuzzleDevice = 'none' | 'brake' | 'flash' | 'shroud';
// アクセント帯(tracerColor)の貼り付け位置
export type AccentBand = 'receiver' | 'handguard' | 'stock' | 'slide';

// レシーバ造形。mono=一体、split=アッパー/ロア分割シーム、tube=円筒アッパー(MP5/Uzi)。
export type ReceiverStyle = 'mono' | 'split' | 'tube';
// 銃身プロファイル。R58 拡張: bull=ブル(太寸胴)、octagon=八角、ported=ポート付き。
export type BarrelProfile = 'plain' | 'fluted' | 'heavy' | 'shroud' | 'bull' | 'octagon' | 'ported';

// 一体型光学機器(覗き口の太さ・長さ・高さ)
export interface ScopeSpec {
  r: number;
  len: number;
  y: number;
}

// 1つの銃シルエットを完全に記述する行。SHAPE_SPECS が ModelKey ごとに保持する。
export interface Silhouette {
  receiver: { w: number; h: number; d: number };
  barrelGauge: number;
  barrelLen: number;
  feed: FeedKind;
  handguard: HandguardKind;
  stock: StockKind;
  scope: ScopeSpec | null;
  boltHandle: boolean;
  muzzle: MuzzleDevice;
  accentBand: AccentBand;
  bodyScale: number;
  // 任意: 給弾部のZオフセット(bullpup=グリップ後方へ)
  feedZ?: number;
  // 任意: 上下二連の二本バレル(shotgun-double)
  twinBarrel?: boolean;
  // 任意: 回転式シリンダ(revolver)
  cylinder?: boolean;
  // ── R11 任意ディテール上書き(全て optional・未指定は resolveDetail が導出) ──
  // レシーバ造形。split=アッパー/ロア分割シーム、tube=円筒アッパー(R58)
  receiverStyle?: ReceiverStyle;
  // 排莢ポート(右面インセット+ブラスデフレクタ)を出すか
  ejectionPort?: boolean;
  // チャージングハンドル種別
  chargingHandle?: 'none' | 'rear' | 'side' | 'top';
  // 上面ピカティニーレール
  railTop?: 'none' | 'short' | 'full';
  // アイアンサイト種別
  ironSight?: 'none' | 'fixed' | 'flip' | 'ghost' | 'bead';
  // グリップ形状
  gripStyle?: 'ar' | 'smg' | 'pistol' | 'wood';
  // 銃身プロファイル(R58 で bull/octagon/ported を追加)
  barrelProfile?: BarrelProfile;
  // 拳銃可動スライド+セレーション
  slide?: boolean;
  // 露出ハンマー(revolver/shotgun-double)
  hammer?: boolean;
  // 放熱スリット本数(0=なし)
  ventSlots?: number;
  // アクセント帯を emissive 化するか(既定 true)
  accentEmissive?: boolean;

  // ── R58 新フィールド(全 optional=後方互換。Phase C painter が実ジオメトリを描く) ──
  // 1. 逆U字/三角キャリーハンドル(サイト内蔵)。上面レール枝後、metalParts。
  //    サイト位置を持ち上げる=sightY計算フック(CARRY_HANDLE_SIGHT_Y)と3点整合(viewmodel)。→FAMAS/SG-512。
  carryHandle?: 'none' | 'ar15' | 'famas';
  // 2. 一体型サプレッサ(太有孔tube、muzzleZ前進)。attachment suppressor と排他(内蔵優先)。→MP5SD。
  integralSuppressor?: boolean;
  // 3. 上部弾倉。pan=天面パンマグ(DP-28。railTop='none'強制)/drum/box。→DP-28/AA-12/USAS。
  topMag?: 'none' | 'pan' | 'drum' | 'box';
  // 4. 弾倉がグリップ内(Uzi/機関拳銃)。feed枝のz0をグリップ内へ。→Uzi/APS。
  magInGrip?: boolean;
  // 5. 折りたたみ前方フォアグリップ(バレル下前傾)。→93R。
  foldingForegrip?: boolean;
  // 6. リボルバー・アンダーラグ(バレル下の鋼材塊、エジェクターロッド内包)。→GP100。
  revolverUnderlug?: 'none' | 'half' | 'full';
  // 8. 家具の基調材(冒頭で C_HANDGUARD/C_STOCK 相当を切替)。→FAL/SVD wood。
  furniture?: 'polymer' | 'wood' | 'metal';
  // 10. バレル外周の有孔放熱シールド(リング列)。
  heatShield?: boolean;
  // 11. バレル上の連続リブ+bead(トラップ/ベンテッドリブSG)。
  ribSight?: boolean;
  // 13. 前方グリップ様式。broomhandle=モーゼル風/vertical-fixed=固定垂直。
  foregripStyle?: 'none' | 'broomhandle' | 'vertical-fixed';
  // 14. スライド様式。glock=角低背+後方セレーション(hammer:false)/lowbore=低ボア。→Glock/CZ75。
  slideProfile?: 'std' | 'glock' | 'lowbore';
  // 15. 八角バレルの帯金本数(0=なし)/ベルト箱(左側面弾薬箱)。
  octalBarrelBands?: number;
  beltBox?: boolean;
  // R58 F4: painter が固有マズル(一体ハイダー/多ポートブレーキ/一体サプ/スリットハイダー)を
  //   barFrontZ より前方まで伸ばす機で、トレーサ/マズルフラッシュ原点(muzzleZ)を造形前端まで
  //   前進させる量(m・前方=正)。viewmodel が muzzleZ を算出後 `muzzleZ -= muzzleExtend` で加味する
  //   (サプ/コンペ装着時は painter マズルが skip されるため適用しない=z<0 契約は不変)。→FAMAS/AWM/MP5SD/SVD。
  muzzleExtend?: number;
}

// シルエット行(寸法)から導出する「造形ディテール」。resolveDetail(viewmodel) が生成する。
export interface DetailSpec {
  receiverStyle: ReceiverStyle;
  ejectionPort: boolean;
  charging: 'none' | 'rear' | 'side' | 'top';
  railTop: 'none' | 'short' | 'full';
  iron: 'none' | 'fixed' | 'flip' | 'ghost' | 'bead';
  grip: 'ar' | 'smg' | 'pistol' | 'wood';
  barrelProfile: BarrelProfile;
  slide: boolean;
  hammer: boolean;
  ventSlots: number;
  brassDeflector: boolean;
  accentEmissive: boolean;
}
