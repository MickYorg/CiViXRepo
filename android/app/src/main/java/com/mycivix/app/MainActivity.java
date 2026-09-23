package com.mycivix.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.InputStream;

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
    getBridge().setWebViewClient(new LiveApiWebViewClient());
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

  // capacitor.config.json's server.hostname ("mycivix.com") makes the bundled
  // pages same-origin with the live site, but on Android it also makes
  // Capacitor's local server claim EVERY https://mycivix.com/* request —
  // including /api/*, which isn't a bundled file, so its SPA fallback
  // answered every Function call with index.html (200, text/html). Returning
  // null here hands those requests back to the WebView's own network stack
  // (POST bodies included), so /api/* and any non-bundled file (e.g. the
  // streamed civix101 explainer video) reach the real site, while bundled
  // pages/scripts keep loading locally. iOS never hit this: WKWebView can't
  // intercept https itself, so it was never serving these locally.
  private class LiveApiWebViewClient extends BridgeWebViewClient {
    LiveApiWebViewClient() {
      super(getBridge());
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      Uri uri = request.getUrl();
      if ("mycivix.com".equals(uri.getHost()) && goesToNetwork(uri.getPath())) return null;
      return super.shouldInterceptRequest(view, request);
    }

    private boolean goesToNetwork(String path) {
      if (path == null) return false;
      if (path.startsWith("/api/")) return true;
      String last = path.substring(path.lastIndexOf('/') + 1);
      if (!last.contains(".")) return false; // directory-style routes stay local
      try (InputStream in = getAssets().open("public" + path)) {
        return false;
      } catch (Exception e) {
        return true;
      }
    }
  }
}
