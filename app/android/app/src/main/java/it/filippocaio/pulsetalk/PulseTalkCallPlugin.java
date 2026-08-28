package it.filippocaio.pulsetalk;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.ref.WeakReference;
import java.util.UUID;

@CapacitorPlugin(
    name = "PulseTalkCall",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class PulseTalkCallPlugin extends Plugin {
    private static WeakReference<PulseTalkCallPlugin> istanza = new WeakReference<>(null);

    @Override
    public void load() {
        istanza = new WeakReference<>(this);
    }

    /**
     * Android 12+ protegge l'uso delle cuffie Bluetooth con un permesso a
     * runtime. Chiederlo qui, una volta sola, lascia al WebRTC la stessa scelta
     * dei dispositivi disponibile sul desktop.
     */
    @PluginMethod
    public void preparaAudio(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetooth") == PermissionState.GRANTED) {
            call.resolve(new JSObject());
            return;
        }
        requestPermissionForAlias("bluetooth", call, "bluetoothPronto");
    }

    @PermissionCallback
    private void bluetoothPronto(PluginCall call) {
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void avvia(PluginCall call) {
        Intent intent = new Intent(getContext(), PulseTalkCallService.class);
        intent.setAction(PulseTalkCallService.AZIONE_AVVIA);
        intent.putExtra(PulseTalkCallService.EXTRA_CANALE, call.getString("canale", "Chiamata"));
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void ferma(PluginCall call) {
        Intent intent = new Intent(getContext(), PulseTalkCallService.class);
        getContext().stopService(intent);
        call.resolve(new JSObject());
    }

    /** Apre il consenso di sistema per catturare lo schermo del telefono. */
    @PluginMethod
    public void avviaCondivisione(PluginCall call) {
        MediaProjectionManager gestore = (MediaProjectionManager) getContext().getSystemService(
            android.content.Context.MEDIA_PROJECTION_SERVICE
        );
        if (gestore == null) {
            call.reject("La cattura schermo non e' disponibile su questo dispositivo.");
            return;
        }
        startActivityForResult(call, gestore.createScreenCaptureIntent(), "risultatoCondivisione");
    }

    @ActivityCallback
    private void risultatoCondivisione(PluginCall call, ActivityResult risultato) {
        if (call == null) return;
        if (risultato.getResultCode() != Activity.RESULT_OK || risultato.getData() == null) {
            call.reject("Condivisione annullata.", "CANCELLED");
            return;
        }

        String sessione = UUID.randomUUID().toString();
        Intent servizio = new Intent(getContext(), PulseTalkProjectionService.class);
        servizio.setAction(PulseTalkProjectionService.AZIONE_AVVIA);
        servizio.putExtra(PulseTalkProjectionService.EXTRA_SESSIONE, sessione);
        servizio.putExtra(PulseTalkProjectionService.EXTRA_RISULTATO, risultato.getResultCode());
        servizio.putExtra(PulseTalkProjectionService.EXTRA_DATI, risultato.getData());
        servizio.putExtra(
            PulseTalkProjectionService.EXTRA_LATO_MASSIMO,
            call.getInt("latoMassimo", 1080)
        );
        servizio.putExtra(PulseTalkProjectionService.EXTRA_FPS, call.getInt("fps", 10));

        try {
            ContextCompat.startForegroundService(getContext(), servizio);
            JSObject risposta = new JSObject();
            risposta.put("sessione", sessione);
            call.resolve(risposta);
        } catch (RuntimeException errore) {
            call.reject("Android non ha potuto avviare la cattura schermo.", errore);
        }
    }

    @PluginMethod
    public void fermaCondivisione(PluginCall call) {
        Intent servizio = new Intent(getContext(), PulseTalkProjectionService.class);
        servizio.setAction(PulseTalkProjectionService.AZIONE_FERMA);
        servizio.putExtra(PulseTalkProjectionService.EXTRA_SESSIONE, call.getString("sessione", ""));
        getContext().startService(servizio);
        call.resolve(new JSObject());
    }

    static void pubblicaFotogramma(String sessione, String dati, int larghezza, int altezza) {
        PulseTalkCallPlugin plugin = istanza.get();
        if (plugin == null || plugin.getActivity() == null) return;
        plugin.getActivity().runOnUiThread(() -> {
            JSObject evento = new JSObject();
            evento.put("sessione", sessione);
            evento.put("dati", dati);
            evento.put("larghezza", larghezza);
            evento.put("altezza", altezza);
            plugin.notifyListeners("fotogrammaSchermo", evento);
        });
    }

    static void condivisioneTerminata(String sessione) {
        PulseTalkCallPlugin plugin = istanza.get();
        if (plugin == null || plugin.getActivity() == null) return;
        plugin.getActivity().runOnUiThread(() -> {
            JSObject evento = new JSObject();
            evento.put("sessione", sessione);
            plugin.notifyListeners("condivisioneTerminata", evento);
        });
    }
}
