# Follower Diff

A Chrome extension that takes snapshots of your Instagram followers and following, so you can see exactly who unfollowed you, who you unfollowed, and who changed their username.

Everything stays in your browser. No servers, no sign-ups, no passwords.

## Features

- Two ways to take a snapshot: an automatic scan, or a manual capture while you scroll
- Compare any two snapshots side by side
- See who doesn't follow you back, and who you don't follow back
- Works with multiple Instagram accounts
- Export and import your data as JSON
- Light and dark themes, with a choice of accent colors

## Installation

1. Download `follower-diff-vX.Y.Z.zip` from the [latest release](https://github.com/anar-bastanov/follower-diff-extension/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

To update, replace the folder with the new version and click the reload button on the extension card.

## Usage

1. Log in on [instagram.com](https://www.instagram.com).
2. Click the Follower Diff icon in the toolbar and pick one:
   - **Automatic scan** fetches both lists for you, pausing between pages like a person would. You can close the popup while it runs.
   - **Manual capture** lets you scroll your Followers and Following lists yourself, while the extension just reads what Instagram loads. Reopen the popup to move on to the next step or to save.
3. Take another snapshot some time later, then open **Changes** (the clock icon in the popup).

## Privacy

The extension only talks to instagram.com, using the session you are already logged in with. Snapshots are stored in your browser's local extension storage and never leave it. You can delete everything from **Settings**.

## Disclaimer

This project is not affiliated with Instagram or Meta. It uses Instagram's private web API, which may change at any time and whose automated use is against Instagram's terms. Requests are kept slow and few, but use it at your own risk.

## License

Copyright &copy; 2026 Anar Bastanov <br>
Distributed under the [MIT License](http://www.opensource.org/licenses/mit-license.php).
