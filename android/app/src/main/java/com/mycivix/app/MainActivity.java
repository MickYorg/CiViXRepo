package com.mycivix.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Native Send-to-CiViX (see AndroidManifest.xml's SEND intent-filter):
// routes an incoming OS share straight into send-to-civix.html using the
// exact same title/text/url query params the PWA share_target already
// defines in manifest.webmanifest, so no change is needed on the receiving
// page — it doesn't know or care whether the share came from the browser's
// installed-PWA path or this native one.
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    routeShareIntent(getIntent());
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    routeShareIntent(intent);
  }

  private void routeShareIntent(Intent intent) {
    if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
    String text = intent.getStringExtra(Intent.EXTRA_TEXT);
    String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
    if (text == null && subject == null) return;

    String url = (text != null && text.trim().matches("^https?://\\S+$")) ? text.trim() : "";
    Uri.Builder builder = Uri.parse("https://mycivix.com/send-to-civix.html").buildUpon();
    if (subject != null) builder.appendQueryParameter("title", subject);
    if (text != null) builder.appendQueryParameter("text", text);
    if (!url.isEmpty()) builder.appendQueryParameter("url", url);
    String target = builder.build().toString();

    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(target));
    }
  }
}
