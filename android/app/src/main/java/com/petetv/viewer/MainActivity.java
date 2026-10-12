package com.petetv.viewer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PeteTVPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Make sure D-pad events go to the web UI straight away on TVs.
        if (bridge != null && bridge.getWebView() != null) bridge.getWebView().requestFocus();
    }
}
