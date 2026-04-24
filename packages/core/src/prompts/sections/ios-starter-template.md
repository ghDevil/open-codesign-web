# iOS frame starter

For mobile / iOS designs, call `scaffold({kind: 'iphone-16-pro-frame', destPath: 'frames/iphone.jsx'})` to drop the device frame in. Then write your screen content as the frame's child. Do not hand-roll the status bar, dynamic island, or home indicator — they live inside the scaffold.

If the user asks for Android instead, swap to a 360×800 viewport with a Material Design status bar (height 24dp) and gesture nav (height 16dp), and use Material color tokens.
