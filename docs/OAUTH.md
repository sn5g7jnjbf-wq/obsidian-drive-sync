# Google認証・長期運用

0.2.0はGoogleへ直接接続します。Cloudflare等の認証中継は使いません。具体的な初回操作はQUICKSTART.mdを参照してください。

## 認証の流れ

1. 利用者がGoogle Cloudで自分のDesktop appクライアントを作成し、Drive APIを有効化。
2. Windowsローカルツールが127.0.0.1の空きポートにだけ一時待受。システムブラウザでGoogleの認証画面を開く。
3. PKCE S256とランダムstateを検証し、Googleの認可コードをGoogleのtoken endpointで交換。OAuthエラー本文・code・tokenはログに残さない。
4. クライアント情報とrefresh tokenを、ランダム128bitの解除コードからPBKDF2-SHA256 600000回で導出したAES-256-GCM鍵で暗号化。
5. 10分以内にiPhoneへ取り込み、Google token endpointへの接続確認後にSecretStorageへ保存。
6. 以後iPhoneがGoogleへ直接refresh。Windowsツールは閉じてよい。

Googleの標準Desktop loopbackフローをWindows上だけで実行します。iPhoneでDesktop loopbackを起動したり、Obsidianを独自iOSアプリとして登録したり、OOB方式を復活させたりしません。PC認証情報をモバイルへ引き継ぐ設計は既存実装にも見られますが、GoogleがObsidianプラグイン向けのこの組合せを公式に保証したという意味ではありません。Google実環境・iPhoneでの認証・更新の受け入れ試験は未実施です。

## スコープ

- 制限付きの任意選択 `https://www.googleapis.com/auth/drive.file`：プラグインで作成・個別に許可されたファイルのみ。フォルダ内の任意の新規ファイルすべてを読む権限ではない。まず自分の専用フォルダと1枚のノートで試す。
- 推奨・既定 `https://www.googleapis.com/auth/drive`：Windowsや外部アプリが新規作成したファイルも対象にできる。同期処理は設定フォルダに限定するが、OAuthの権限自体はDrive全体に及ぶ。漏洩時の影響が大きい。Googleの制限付きスコープに関するポリシーに従う。

権限変更時はWindowsで再認証して設定を再取込。フォルダIDを入力するだけではOAuthのアクセス権は増えません。

## 長期運用

Drive権限を含むExternal/Testingの更新トークンは原則7日で失効します。試験には使えますが常用設定ではありません。常用時はGoogle Auth PlatformのAudienceで公開ステータスを確認し、個人利用・要求スコープに適用される条件を確認してIn productionへの切替を検討します。「本番」は本プラグインの品質認定を意味しません。公開ステータス変更をこちらで自動実行しません。

公開配布・組織利用・多数ユーザー向けではGoogleのアプリ検証や管理者許可が必要になる場合があります。個人用クライアントを多数の人と共有しません。Googleが認証を拒否した場合、偽のアプリ種別や廃止フローで回避しません。

本番ステータスでも永久認証ではありません。ユーザーの取消、未使用期間、発行数制限、Google側のポリシー等で失効する場合は、ローカルツールで再認証します。ノートを削除したり同期基準を消したりして解決しないでください。

## 保存と解除

- Google CloudからダウンロードしたJSONは利用者が管理。ローカルツールは選ばれたJSONをブラウザからlocalhostへ受け取り、メモリで使うだけ。
- ローカルツールは20分で終了。トークン・暗号化設定・コードを自動でディスク保存しない。
- 解除コードと暗号化設定を両方知る人は、期限内に接続設定を取り込める。10分の期限はクライアント側の検査で、漏洩した秘密鍵・token自体を10分後にGoogleが失効するという意味ではない。改造クライアントは期限検査を回避できる。漏洩時はGoogleでrevokeする。
- 中央サーバーを置かないため、設定文字列を暗号学的に一度しか使えなくする保証はない。同じものを期限内に再取込可能。複数端末へ無闇に配布しない。
- iPhoneではclient secretとrefresh tokenをまとめてSecretStorageへ保存。access tokenはメモリ。設定data.jsonには保存しない。SecretStorageをハードウェア暗号化や他プラグインからの隔離と断定しない。
- 接続解除はローカル保存値を空にし、Googleのrevokeを試みる。同一プロジェクトの他端末の認証にも影響し得る。オフライン時はローカルだけ解除されるのでGoogleアカウントの連携設定からも取り消す。
- 0.1.0から更新する場合、旧版を先に解除してGoogle側の許可も確認。旧token形式は引き継がない。ノート・同期基準は保持し、認証だけ再取込する。

## 公式資料

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/limits
- https://docs.obsidian.md/plugins/guides/secret-storage
