# Follower Diff

Instagram tells you how many followers you have, but not who left. Follower Diff fills that gap. It saves snapshots of a profile's followers and following, and compares any two of them, so you can see exactly who unfollowed, who started following, who you unfollowed (on purpose or by accident), and whose account disappeared.

It works on any profile whose lists you can see, not just your own, and everything stays in your browser. No servers, no sign-ups, no passwords.

> [!WARNING]
> This project is not affiliated with Instagram or Meta. It uses Instagram's private web API, which may change at any time and whose automated use is against Instagram's terms. Requests are kept slow and few, but use it at your own risk.

## Features

- Scan any profile whose lists you can see: your own, public accounts, or private ones you follow
- Two ways to take a snapshot: an automatic scan, or a manual capture while you scroll the lists yourself
- A plain diff between any two snapshots: +1 / −1 per account, for followers and following
- Username changes are recognized, because every account is tracked by its permanent Instagram ID
- Per-snapshot lists of who doesn't follow back and who isn't followed back

## Installation

1. Download `follower-diff-vX.Y.Z.zip` from the [latest release](https://github.com/anar-bastanov/follower-diff-extension/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

To update, replace the folder with the new version and click the reload button on the extension card.

## Usage

1. Log in on [instagram.com](https://www.instagram.com) and open the profile you want to scan.
2. Click the Follower Diff icon in the toolbar. It shows that profile and, if its lists are visible to you, two options:
   - **Automatic scan** fetches both lists, pausing between pages like a person would. The popup shows an estimate of how long it will take, and you can close it while the scan runs.
   - **Manual capture** lets you open the profile's Followers and Following lists and scroll to the bottom, while the extension only reads what Instagram loads. Reopen the popup to save.
3. Scan the same profile again some time later. Then click the profile card in the popup, or open the dashboard (the clock icon), to see the changes.

In the dashboard, each scanned profile has a card. A profile's page has two tabs: **Changes**, which compares any two of its snapshots, and **Snapshots**, its full history.

Lists larger than 5,000 accounts aren't supported: they would take too long to scan and run into Instagram's limits.

## Privacy

The extension only talks to instagram.com, using the session you are already logged in with. Snapshots are stored in your browser's local extension storage and never leave it. You can delete everything from **Settings**.

## License

Copyright &copy; 2026 Anar Bastanov <br>
Distributed under the [MIT License](http://www.opensource.org/licenses/mit-license.php).
