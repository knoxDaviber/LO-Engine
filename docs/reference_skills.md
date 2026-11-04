# Skill mechanics reference

Offline notes on skill mechanics from other games, so design work doesn't need a browser. **Ideas only:** names, numbers and wording here belong to those games, so never copy them into content. Everything is described in our own words.

| Source | Coverage | Licence note |
|---|---|---|
| Etrian Odyssey X, [EO-Skill-Sim](https://github.com/ReinaSakuraba/EO-Skill-Sim) | All 18 classes: 409 of 494 skills tagged (index below) | Repo code is MIT; the game's content is not ours |
| Unicorn Overlord, [hyperWiki active skills](https://hyperwiki.jp/unicorn/active-skill/) | 219 active skills (index below). Passive, brave and leader skills not collected | Fan guide |
| Langrisser Mobile, [wiki](https://langrisser.fandom.com/wiki/Skills) | Partial, examples in the family table only. See "Still missing" | CC BY-NC-SA |

Collected 2026-11-04. The family table was drafted with DeepSeek, then its fit ratings were corrected against the engine.

## Mechanic families

Fit means fit with our engine today: 2x3 slots, no map, PP instead of cooldowns, tactic sheets.

| Family | What it does | Examples | Fit | How we would adapt it |
|---|---|---|---|---|
| Cover | An ally takes the hit for another, sometimes only below an HP line or a set number of times | EO Ally Shield, EO Great Bravery, LM Fearless Stance | Fits now | `cover` effect, limited by Passive PP and Main / Sub conditions |
| Counterattack | Strikes back when the unit or an ally is hit | EO Cross Counter, EO Shield Flare, LM Barb | Fits now | Like Counter; PP is the cap |
| Follow-up | Extra strikes when allies attack, or finishing blows on weak targets | EO Link skills, EO Warrior Might, EO Execution | Fits now | Like Follow-Up and Pursuit, plus an HP condition |
| HP as a cost | Spends own or allies' HP for power | EO Draining Thrust, EO Legion Thrust, LM Blood-Boiling Charge | Small engine work | Needs a self HP cost effect. Mind the HP% timeout rule |
| Lifesteal and kill rewards | Heals or refunds on damage dealt or a kill | UO Lean Edge, LM Kiss of the Succubus, EO Turning Tide | Small engine work | Kill rewards exist on blessings (Gift ATK); heal by damage dealt is new |
| Fatal-hit prevention | Survives one lethal hit | EO Aegis, LM Heart of the Twin Moons | Fits now | `intercepts_death` status, as Fairy's Grace. A chance roll would be new |
| Revival | Brings back a dead unit, by itself or an ally | EO Auto-Revive, UO Resurrection, UO Animate Dead | Larger work | No true revive yet; would be official tier only |
| Damage negation | Cancels whole hits, by count or for a turn | EO Painless, EO Shadow Cloak, UO Dark Armor | Small engine work | Counted hit shield is new. `total_reduction_cap_percent` blocks full negation through `reduce_damage` |
| Targeting pressure | Draws attacks, avoids them, or makes decoys | EO Taunt, EO Play Possum, EO Ninpo Mirage | Partly | Taunt needs a new targeting mode (`overrides_targeting` only does confusion today); decoys in slots are a poor fit |
| Delayed effects | Resolves after a wait or a charge turn | EO Delayed Heal, EO Sagittarius Shot, UO Circle Heal | Small engine work | Pending effect keyed to the unit's action count |
| Battle-start effects | Auto-casts or shields at the start | EO Preemptive Taunt, EO Battle Instinct | Fits now | `pre_battle` passives, as Preventative Care |
| Conditional damage | More damage by target state, timing or type | EO Raging Billows, EO Duel, LM Back Stab, UO Cavalry Slay | Partly | `bonus_vs_class` exists. Bonuses by target state need one new field; Main can only gate the whole skill |
| Resource play | Steals, gives or refunds PP | UO Passive Steal, EO Share the Wealth, EO Reflexes | Fits now | `modify_pp`, official tier only. Keep steals small: 3 PP is the whole budget |
| Cleansing and transfer | Strips buffs, removes debuffs, moves ailments | EO Releasal Spell, LM Annihilation, EO Refresh, EO Displace | Partly | `remove_buffs` exists; removing debuffs and transfer are new |
| Stances and lockouts | Lasting self state, or a big hit followed by a lockout | EO Ronin stances, EO Miasma Armor, EO Imperial Drive, LM Blood Frenzy | Partly | Stances as timed statuses; lockouts are small work. Extra actions clash with the fixed PP budget |
| Team and row buffs | Row, faction or team-wide stat raises | EO Attack Order, UO Offense Orders, LM Fusion Power | Fits now | Rally, auras and statuses. Decide stacking per category |
| Hit patterns | Multi-hit, random targets, splash, pierce, partial DEF ignore | EO Swift Edge, EO Meteor, EO Splash Shot, UO Spinning Edge | Partly | Row and column exist. `ignore_defense` is blessing-only today; random and splash are new |
| Instant death and chaos | Instant kills, HP set to 1, random statuses | UO Fallen One, EO Beheading, UO Chaos | Poor fit | High variance in a deterministic auto-battler. Skip outside special encounters |

## Index: Etrian Odyssey X

Each skill is listed once, under its first matching tag. Tags were assigned by keyword, so some will be wrong. Skills with no matching tag are left out.

- **Cover / protect (11):** Heroic Steel, Great Bravery, Ally Shield, Taunt, Line Shield, Chain Dance, Scapegoat, Diversion Gambit, Play Possum, Great Warrior, Decoy Sign
- **Counter / retaliate (13):** Afterimage, Encourage, Shield Flare, Finishing Shot, Multi-Shot, Ninpo: Caltrops, Revenge Bomb, Front Command, Endure Command, Shot Command, Warrior Might, Double Punch, Cross Counter
- **Follow-up / chase (12):** Shock Spark, Blazing Link, Freezing Link, Electric Link, Improved Link, Smash Link, Link Mastery, Link Finale, Bind Rush, One-Two Punch, Following Strike, Leading Blow
- **HP as a cost (15):** Draining Thrust, Legion Thrust, Spirit Shield, Draining Burst, Delayed Charge, Legion Burst, Blood Fortune, Bloody Offense, Cross Charge, Legion Charge, Ninpo: Double, Ninpo: Smoke, Flee, Seppuku, Devil's Fist
- **Lifesteal / on-damage restore (7):** Vampire, Mind Drain, Hero Battle, Gae Bolg, Black Sabbath, Tactical Decree, Healing Decree
- **Kill trigger (4):** Turning Tide, Etheric Return, Blessed Remains, Bloody Lance
- **Survive / revive (8):** Aegis, Auto-Revive, Resuscitate, War Revive, Morale Boost, Reincarnation, Dismiss Revive, Soul Transfer
- **Negate / nullify (17):** Painless, Risk Perception, Fairy Robe, Barrier, Battle Instinct, Royal Lineage, Prevent Order, Renew, Anti-Ether, Decoy Party, Full Charge, Shadow Cloak, Enduring Cloak, Warding Mist, Death Tolerance, Miasma Wall, Spirit Barrier
- **Delayed / timed (49):** Miracle Edge, Charge Image, Dark Image, Guard Rush, Preemptive Taunt, Keep Guard, Patch Up, Delayed Heal, Overheal, Deja Vu, Sagittarius Shot, Swallow Strike, Stone Thrust, Petal Scatter, War Heal, War Heal Line, War Heal All, Spear Assist, Allied Bonds, Act Quick, Preemptive Fire, Preemptive Flare, Protect Order, Auto-Mirage, Etheric Charge, Fire Prophecy, Ice Prophecy, Volt Prophecy, Multi-Strike Ether, Fearless, Echoing Slash, Falcon Slash, Auto-Cloak, Spread Throw, Auto-Spread, Circle Boon, Chain Circle, Snare Circle, Nerve Circle, Curse Circle, Hood Circle, Sleep Circle, Poison Circle, Chaos Circle, Conversion, Charge Edge, Breather, Meditation, Spirit Absorb
- **Battle-start auto cast (1):** Miasma Armor
- **Remove buffs or debuffs (13):** Clear Mind, Fervor, Recovery Guard, Refresh, Unbind, Displace, Negotiation, Element Bomb I, Element Bomb II, Clearance, Final Decree, Releasal Spell, Atonement
- **Conditional damage (13):** Duel, Rouse, Drawing Slice, Singularity, Ether Mastery, Etheric Boon, Harvest Festival, Peerless Demon, Single Devotion, Proficiency, Raging Billows, Resonance Blow, Ephemeral Reap
- **Stance / lasting state (64):** Burst Blade, Fire Wall, Ice Wall, Volt Wall, Multi-Shot, Musou, Upper Stance, Upward Slash, Clear Stance, Charging Thrust, Drawing Stance, Sheath Strike, Air Blade, Arm Strike, Helm Splitter, Flame Grater, Haze Slash, Lightning Stab, Horizontal Slice, Frigid Slash, Full Proficiency, Rouse Spirits, Rapid Fire, Penetrator, Ricochet, Proof of Nobility, Royal Veil, Hawk Strike, Meteor, 5-Ring Sword, Double Strike, Swift Stab, Swift Edge, Circle Paradise, Dismiss Heal, Proficiency, Dismiss Blow, Dismiss Blast, Dismiss Quake, Ignition, Sharp Edge, Assault Drive, Heat Sink, Heat Shield, Cool Edge, Intercooler, Flame Drive, Freeze Drive, Shock Drive, Accel Drive, Fault Blocker, Lash Out, Endless Armor, Miasma Tsunami, Paralyzing Reap, Toxic Reap, Endless Shroud, Wilting Miasma, Binding Miasma, Darkness Reap, Chaos Reap, Black Shroud, Black Wave, Enduring Armor
- **Multi-hit / random (1):** Ninpo: Daggers
- **Row / pierce / splash (34):** Frigid Slash, Force Gift, Front Guard, Rear Guard, Healing Wall, Heal Guard, Line Heal, Power Shot, Flank Shot, Drop Shot, Trickery, Efficiency, Splash Shot, Cover Support, Shell Shock, Feint Shot, Attack Order, Fire Arms, Freeze Arms, Shock Arms, Guard Order, Rally Order, Dauntless Order, Proficiency, Etheric Gleam, Fire Star, Ice Star, Volt Star, Dark Ether, Share the Wealth, Morning Star, Spiral Slice, Penetrate, Massive Edge
- **Debuff / ailment (67):** Act Breaker, Shield Smite, Shield Bash, Head Bash, Group Therapy, Chase Heal, Blind Arrow, Disabling Shot, Issen, Random Disease, Strength Slash, Guard Slash, Headcut, Armcut, Legcut, Status DEF Up, Epidemic, Head Pierce, Leg Snipe, Arm Snipe, Head Snipe, Ninpo: Toxic Mist, Shadow Bind, Ninpo: Mirror, Izuna, Beheading, Status ATK Up, Ninpo: Panic, Return Malice, Sympathy Pain, Strange Seeds, Rotten Egg, Lullaby, Curse Strike, Execution, Swift Justice, Vanguard, Killing Intent, Sand Throw, Sleep Throw, Curse Throw, Nerve Throw, Backstab, Foul Mastery, Venom Throw, Assassinate, Charm Eye, Atrophic Eye, TP Return, Trip Edge, Final Blow, Concussion, Arm Breaker, Low Blow, Corkscrew, Adrenaline, Clinch, Eroding Miasma, Stifling Miasma, Sluggish Miasma, Fatal Reap
- **Buff (54):** Brave Heart, Heroic Bonds, Physical Shield, Elemental Shield, Shield Protect, Fortify, Phys DEF Up, Elem DEF Up, HP Up, Intensive Care, Antibodies, Scavenge, Staff Mastery, Illusory Formation, Sorting Skill, Speed Up, Sneak Attack, Phys ATK Up, War Edge Mastery, Ailing Slash, Bloody Veil, Pop Flare, TP Up, Victory Vow, Concealment, Dominance, Earth's Bounty, Waste Not, Unified Effort, Second Sword, Avidya Sight, Taunt Assassins, Twilight Hour, Trinity, Initiative, Disaster, Circle Mastery, Heavy Guard, Elem ATK Up, Fighting Spirit
- **Heal (13):** Healing, Final Gift, Heal-All, Breath, Artery, War Response, Medic Bullet, Reinforce, Monarch March, Survival Wisdom, Bracing Walk, Blood Edge, Avenger
- **Resource return (13):** Graceful Image, Retain Force, Double Action, Reflexes, Mystic Calm, Divination, Astrosign, Free Energy, Final Secret, Fruitful Song, Impulse Edge, Force Edge, Absorber

## Index: Unicorn Overlord active skills

Format: name (power x hits, AP cost). Tags were assigned by keyword.

- **Heal on hit or kill (18):** リーンエッジ (100x1, 1 AP), ブラッドウェポン (100x1, 1 AP), ブラッドダーツ (100x1, 2 AP), ブラッドレイン (50x3, 2 AP), マッシブチャージ (0x1, 1 AP), ヒール (100x1, 1 AP), ダブルヒール (60x1, 1 AP), ラインヒール (100x1, 1 AP), セイクリッドヒール (100x1, 2 AP), サークルヒール (150x1, 2 AP), レイディアントヒール (150x1, 3 AP), アクトヒール (100x1, 2 AP), エクストラヒール (100x1, 2 AP), オーバーヒール (50x1, 1 AP), リミテッドヒール (50x1, 2 AP), フェアリーヒール (100x1, 2 AP), キュアエール (50x1, 1 AP), ヒールウインド (0x1, 2 AP)
- **Bonus vs class (21):** キャバルリースレイ (100x1, 1 AP), バーティカルエッジ (100x1, 1 AP), アイアンリッパー (100x1, 1 AP), ロングスラスト (100x1, 1 AP), ジャベリン (100x1, 1 AP), フレイムジャベリン (150x1, 2 AP), エンハンスドスピア (130x1, 2 AP), フォールスラスト (100x1, 1 AP), テンペストドライブ (150x1, 2 AP), ヘヴィバスター (100x1, 1 AP), ラインバスター (100x1, 2 AP), グランドストライク (150x1, 2 AP), ハイスイング (100x1, 1 AP), エリアルスマイト (150x1, 2 AP), ソニックブーム (70x1, 1 AP), ダブルソニック (70x1, 2 AP), ミスティックアロー (100x1, 1 AP), エアスラスト (75x1, 2 AP), グレムリングレイブ (100x1, 1 AP), シルフィードウインド (40x3, 2 AP), 天獄殺 (20x7, 2 AP)
- **Guard seal (3):** ピアシングランス (100x1, 1 AP), フォトンアロー (80x1, 2 AP), ディフェンスカース (0x1, 1 AP)
- **Drain AP or PP (32):** スピニングエッジ (60x2, 2 AP), ディフェンダー (75x2, 2 AP), インペイル (100x1, 1 AP), キリングチェイン (100x1, 1 AP), ハッシュ (100x1, 1 AP), セイントブレード (50x2, 1 AP), スライス (100x1, 1 AP), ディバインクロス (50x2, 2 AP), ブランディッシュ (50x3, 2 AP), バーンエッジ (75x2, 1 AP), インフェルノ (100x1, 2 AP), アサルトランス (100x1, 1 AP), パイルスラスト (50x3, 2 AP), アサルトブロウ (100x1, 1 AP), カーネイジ (100x1, 1 AP), ディアボネイター (75x2, 2 AP), プリムスエッジ (50x1, 1 AP), リープスラッシュ (100x1, 1 AP), ランペイジ (100x1, 1 AP), ファントムウェポン (120x1, 1 AP), エルフスレイ (100x1, 2 AP), ビーストスレイ (100x1, 2 AP), アクティブブレイク (100x1, 1 AP), パッシブブレイク (50x1, 1 AP), セイントショット (80x1, 1 AP), 牙突迅雷 (100x1, 2 AP), パッシブカース (0x1, 1 AP), グレートシールド (0x1, 1 AP), ミスティックシールド (0x1, 1 AP), ダークミスト (0x1, 1 AP), アニメイトデッド (100x1, 1 AP)
- **Ignores defense (1):** カースストライク (100x1, 2 AP)
- **Negate hits (6):** ダークアーマー (0x1, 1 AP), グロウライト (0x1, 1 AP), ウォール盾/大 (0x1, 1 AP), グレートウォール大 (0x1, 2 AP), マジックウォール (0x1, 1 AP), リンカネーション杖/ (0x1, 3 AP)
- **Remove buffs or debuffs (6):** バニッシュスタブ (100x1, 1 AP), バニッシュスマイト (100x1, 2 AP), ホーリーライト (100x1, 1 AP), イノセントレイ (150x1, 2 AP), ホーリースマイト (200x1, 2 AP), オールディスペル (0x1, 2 AP)
- **Status (37):** トキシックスロー (25x2, 1 AP), シャドウバイト (15x2, 2 AP), ヴェノムスラスト (75x1, 2 AP), ファイアブレス (75x1, 2 AP), ヴェノムアックス (75x1, 1 AP), ダークフレイム (50x1, 2 AP), フレイムスラスト (100x1, 1 AP), デッドリーラッシュ (40x4, 1 AP), フリーズスラスト (100x1, 1 AP), ポイズンスラッシュ (100x1, 1 AP), ファイアスラッシュ (100x1, 1 AP), ゴアポイズン (150x1, 2 AP), ゴアファイア (150x1, 2 AP), ファイアネイト (100x1, 1 AP), アイスネイト (100x1, 1 AP), アサシンネイル (100x1, 2 AP), アイスブロウ (100x1, 1 AP), アイスクラッシュ (100x1, 2 AP), アイシクルダート (100x1, 2 AP), シェイドスラスト (80x1, 1 AP), リーサルヴェノム (100x1, 3 AP), グラシアルレイン (60x3, 2 AP), ポイズンアロー (100x1, 1 AP), フレイムアロー (100x1, 1 AP), シェイドアロー (100x1, 1 AP), アイシクルアロー (75x1, 2 AP), トキシックボルト (80x1, 1 AP), ファイアーボール (40x3, 1 AP), アイスショット (100x1, 1 AP), アイスコフィン (100x1, 2 AP), アクアヴェノム (100x1, 1 AP), メイルシュトローム (25x3, 2 AP), ヴォルケーノ (150x1, 2 AP), ブリザード (50x3, 2 AP), ポイズンカース (0x1, 1 AP), ファイアカース (0x1, 1 AP), サンドストーム (0x1, 3 AP)
- **Stat down (16):** スパイラルソード (100x1, 1 AP), シールドスマイト (100x1, 1 AP), インパルス (100x1, 1 AP), スマッシュ (100x1, 1 AP), ロールアックス (40x3, 1 AP), ワイドブレイカー (100x1, 2 AP), ペネトレートクラス (100x1, 2 AP), パワーブレイク (100x1, 1 AP), パワーブレイクⅡ (150x1, 2 AP), アーマーブレイク (100x1, 1 AP), アーマーブレイクⅡ (150x1, 2 AP), マジックブレイク (75x1, 2 AP), トリプルブレイク (50x1, 2 AP), ウインドアロー (75x1, 1 AP), ディレイショット (25x4, 1 AP), オフェンスカース (0x1, 1 AP)
- **Stat up (9):** ガードスラッシュ (100x1, 1 AP), シャープエッジ (100x1, 1 AP), メテオスラッシュ (20x9, 2 AP), フィニッシュスタブ (100x1, 1 AP), ナイトビジョン (0x1, 1 AP), オフェンスオーダー (0x1, 1 AP), ディフェンスオーダー (0x1, 1 AP), ラインプロテクト (0x1, 1 AP), ラインレジスト (0x1, 1 AP)
- **Other: 回復スキル (1):** リザレクション (0x1, 2 AP)
- **Other: 妨害スキル (4):** フォールン・ワン (0x1, 2 AP), 終わりなき混沌 (0x1, 2 AP), パッシブアブソーブ (0x1, 1 AP), カースハザード (0x1, 1 AP)
- **Other: 攻撃スキル (60):** アストラルブレード (150x1, 2 AP), シールドバッシュ (50x1, 1 AP), パッシブスティール (50x2, 1 AP), アクティブスティール (25x4, 2 AP), ライトニングソード (75x1, 1 AP), ミラージュスタブ (75x1, 2 AP), メガスラッシュ (150x1, 1 AP), バスタードクロス (70x2, 2 AP), デシマルキラー (75x1, 1 AP), ワイルドファング (20x3, 2 AP), エンハンスラッシュ (70x3, 2 AP), ワイルドラッシュ (80x1, 1 AP), スティング (100x1, 1 AP), パッシブホールド (100x1, 1 AP), ドラグーンダイブ (100x1, 2 AP), フェイタルフォール (0x1, 2 AP), デッドスピニング (75x1, 1 AP), ベアクラッシュ (100x1, 1 AP), アラウンドスイング (25x3, 2 AP), アーススタンプ (75x1, 2 AP), リベンジアックス (50x1, 1 AP), デスペレイト (0x1, 2 AP), ワイドスマッシュ (150x1, 1 AP), グランドスラム (100x1, 2 AP), ブルータルスイング (80x1, 1 AP), ブルータルドライブ (50x1, 1 AP), エクスティンクション (50x1, 2 AP), サンダースラスト (100x1, 1 AP), エレメンタルロアー (70x1, 3 AP), ヘイトスラッシュ (75x1, 1 AP), クラッシュ (100x1, 1 AP), スパイクブロウ (50x3, 1 AP), トゥルースラスト (80x1, 1 AP), ライトニングシェイカー (100x1, 2 AP), エクスキューション (100x1, 1 AP), マッスルインパクト (200x1, 2 AP), デモリッション (300x1, 2 AP), ヘヴィスマッシュ (100x1, 2 AP), ペインスマッシュ (150x1, 2 AP), マジックウェポン (150x1, 1 AP), シングルショット (100x1, 1 AP), ダブルショット (70x1, 1 AP), ラインショット (100x1, 2 AP), アローレイン (60x3, 2 AP), ソニックシャフト (100x1, 1 AP), チェックメイト (150x1, 2 AP), パワーボルト (120x1, 1 AP), ヘヴィボルト (100x1, 2 AP), ハープーンボルト (100x1, 2 AP), スパイクボルト (50x4, 2 AP), マジックミサイル (70x1, 1 AP), サンダーストラック (100x1, 2 AP), アースクエイク (100x1, 3 AP), グラビティ (0x1, 2 AP), トリニティレイン (100x3, 3 AP), メメント・モリ (80x1, 1 AP), ユニコルヌス・イラ (999x1, 4 AP), ソーサリーブロウ (150x1, 2 AP), オメガブレイク (100x2, 2 AP), 竜断 (100x2, 1 AP)
- **Other: 補助スキル (5):** オーロラヴェール (0x1, 1 AP), ファントムヴェール (0x1, 2 AP), ヒールエンハンス (0x1, 1 AP), ホーリークレイドルクラス (0x1, 2 AP), ミスティックセイバー (0x1, 1 AP)

## Still missing

- **Langrisser Mobile:** the zip held only page assets, not the saved pages. Re-export the 9 skill pages with their `.html` files to fill this in.
- **Etrian Odyssey Nexus Weapon Skills:** same problem, the page itself is not in the zip.
- **Unicorn Overlord:** passive, brave and leader skills are on separate pages.
