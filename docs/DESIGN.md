# 技術設計 0.2.0

## 実装前の調査と方針

ObsidianはホストiOSアプリであり、プラグインがGoogle SDKをネイティブ追加したり独自URL schemeを登録したりできません。中継サーバーなしで使うため、初回のGoogle認可のみWindowsで行い、暗号化した接続情報をiPhoneへ渡します。GoogleはWindowsのDesktop OAuth loopbackを公式にサポートしています。この情報引継ぎ構成そのもののGoogle公式保証や実機試験は確認していません。

## 費用・保守

- 同期先は利用者のGoogle Drive通常フォルダ。Google API標準利用と保存容量は公式案内の無料範囲内で使う。
- 作者サーバー・Cloudflare・独自ドメイン・有料ホスティングを不要にする。
- Windows認証ツールはNode.js 22以上と標準APIのみ。npmパッケージをインストールせず配布mjsを実行できる。
- プラグインにはNode APIを含めない。ビルド時の依存はTypeScript、Obsidian型、esbuild、tsx、Node型のみ。
- 普通の.mdと添付で保存するので、実装が使えなくなっても他のツールへ移行可能。
- 永久無料・API不変・再認証不要は保証しない。Google/Obsidianの仕様変更の保守は残る。

## 認証

ローカル認証ツールは127.0.0.1のランダムポートのみ待受。setup URLはランダム256bit識別子、Host固定チェック、POSTは同一Originのみ、body上限、CSP、no-storeを使います。認可URLはaccounts.google.com、交換・更新はoauth2.googleapis.comへ固定。stateとPKCE S256を検証。Googleが返したtoken_uri等を無条件に信用しません。

ブラウザのsetup画面から利用者のDesktop client JSONを選択。認可コードは一度処理し、再callbackは拒否。トークンはメモリだけで扱い、設定はAES-256-GCM、ランダム128bitコード＋PBKDF2-SHA256 600000回で暗号化。取込期限は10分、ツールは20分終了。期限と一回使用の制約は中央失効機構ではない点をOAUTH.mdに明示。

iPhoneはGoogleとのrefreshを確認してから、client情報とrefresh tokenをObsidian SecretStorageへ保存。access tokenはメモリ。SecretStorage未対応環境では平文へフォールバックせず停止。

## 同期

- Obsidian 1.11.4以上。Vault API・requestUrl・Web Cryptoを使用。
- Drive v3のページング付きフォルダ列挙。Drive versionとローカルSHA-256で変更判定。未変更の本文転送を省略。
- 初回同名異内容・両側編集は両原本を保持し、Drive版をローカル競合コピーへ保存。自動マージしない。
- ローカル変更時は旧Drive内容を履歴保存後、ETag付き単一media PATCH。ETagが得られない場合は拒否。If-Matchの実APIでの原子的動作は未確認のため受け入れ試験必須。
- リモート変更時は旧ローカル内容を履歴保存。MarkdownはVault.process内で内容比較し更新する。バイナリは原子的CASがないため競合コピーにする。
- 操作前にジャーナル保存、操作後に基準保存。作成時はDrive事前生成IDを保存して応答喪失時の重複を抑制。終了後は再列挙・再ハッシュで評価。
- 削除・移動は伝播しない。追跡済み片側消失は保留。リネームの新名は追加扱い。
- 両側どちらかが容量上限以上ならそのパスを保留。除外設定で既存Driveを削除しない。
- dotパス、AI Drive Sync領域、Windows非互換名、重複名、大小文字・Unicode衝突、ファイルとフォルダの衝突は除外または安全停止。
- アプリ内単一実行ロック。複数端末間の分散ロックは未実装。
- 起動時はlayout readyと認証取込済みを確認。周期実行は表示中のみ。iOSのバックグラウンド停止に依存しない。

## 権限

制限付きのdrive.fileはアプリが作成・個別許可されたファイルに限定。フォルダ配下すべてが可視とは仮定しない。Windows・外部アプリの任意の新規ファイルも対象にしたい場合、Windows認証画面でdrive全体を明示的に選択する。Pickerによる個別許可追加は未実装。

## 未達・代替

既存バイナリの安全な自動置換はコピーで代替。ChatGPTの通常.md本文取得はアカウント環境により確認が必要で、不可なら別コピーの.txtを手動添付。実Google/iPhone/Windows Drive/Hermes試験は未実施。詳細はSTATUS.md。

## 公式資料

- https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts
- https://github.com/obsidianmd/obsidian-sample-plugin
- https://docs.obsidian.md/plugins/guides/secret-storage
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/guides/limits
- https://learn.chatgpt.com/docs/web
