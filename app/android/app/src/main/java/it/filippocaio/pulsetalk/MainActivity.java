package it.filippocaio.pulsetalk;

import android.os.Bundle;
import android.webkit.WebView;
import android.content.pm.ApplicationInfo;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        registerPlugin(PulseTalkCallPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
