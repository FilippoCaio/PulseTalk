package it.filippocaio.pulsetalk;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Cattura lo schermo con MediaProjection e consegna fotogrammi JPEG alla
 * WebView. Li' un canvas diventa una MediaStreamTrack pubblicabile da LiveKit.
 */
public class PulseTalkProjectionService extends Service {
    public static final String AZIONE_AVVIA = "pulsetalk.proiezione.AVVIA";
    public static final String AZIONE_FERMA = "pulsetalk.proiezione.FERMA";
    public static final String EXTRA_SESSIONE = "sessione";
    public static final String EXTRA_RISULTATO = "risultato";
    public static final String EXTRA_DATI = "dati";
    public static final String EXTRA_LATO_MASSIMO = "latoMassimo";
    public static final String EXTRA_FPS = "fps";

    private static final String CANALE_NOTIFICA = "condivisione_schermo";
    private static final int ID_NOTIFICA = 715;

    private HandlerThread filo;
    private Handler lavoro;
    private MediaProjection proiezione;
    private VirtualDisplay schermoVirtuale;
    private ImageReader lettore;
    private String sessione;
    private long ultimoFotogramma;
    private int intervalloMs = 100;
    private int latoMassimo = 1080;

    @Override
    public void onCreate() {
        super.onCreate();
        filo = new HandlerThread("PulseTalkScreenCapture");
        filo.start();
        lavoro = new Handler(filo.getLooper());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel canale = new NotificationChannel(
                CANALE_NOTIFICA,
                "Condivisione schermo",
                NotificationManager.IMPORTANCE_LOW
            );
            canale.setDescription("Mostra quando PulseTalk sta condividendo lo schermo");
            getSystemService(NotificationManager.class).createNotificationChannel(canale);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        if (AZIONE_FERMA.equals(intent.getAction())) {
            terminaSe(intent.getStringExtra(EXTRA_SESSIONE), false);
            return START_NOT_STICKY;
        }
        if (!AZIONE_AVVIA.equals(intent.getAction())) return START_NOT_STICKY;

        avviaInPrimoPiano();
        avviaProiezione(intent);
        return START_NOT_STICKY;
    }

    private void avviaInPrimoPiano() {
        Intent apri = new Intent(this, MainActivity.class).setFlags(
            Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );
        PendingIntent contenuto = PendingIntent.getActivity(
            this,
            1,
            apri,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        Notification notifica = new NotificationCompat.Builder(this, CANALE_NOTIFICA)
            .setSmallIcon(R.drawable.ic_stat_pulsetalk)
            .setContentTitle("PulseTalk — schermo condiviso")
            .setContentText("Tocca per tornare alla chiamata")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(contenuto)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
        ServiceCompat.startForeground(
            this,
            ID_NOTIFICA,
            notifica,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                : 0
        );
    }

    private void avviaProiezione(Intent intent) {
        final String nuovaSessione = intent.getStringExtra(EXTRA_SESSIONE);
        Intent dati = intent.getParcelableExtra(EXTRA_DATI);
        int risultato = intent.getIntExtra(EXTRA_RISULTATO, Activity.RESULT_CANCELED);
        if (nuovaSessione == null || dati == null || risultato != Activity.RESULT_OK) {
            termina(false, true);
            return;
        }

        // Una nuova scelta sostituisce la precedente senza far chiudere la
        // publication LiveKit: sara' replaceTrack a scambiare le due tracce.
        termina(false, false);
        sessione = nuovaSessione;
        latoMassimo = Math.max(360, Math.min(1600, intent.getIntExtra(EXTRA_LATO_MASSIMO, 1080)));
        int fps = Math.max(2, Math.min(12, intent.getIntExtra(EXTRA_FPS, 10)));
        intervalloMs = 1000 / fps;
        ultimoFotogramma = 0;

        MediaProjectionManager gestore = (MediaProjectionManager) getSystemService(
            Context.MEDIA_PROJECTION_SERVICE
        );
        if (gestore == null) {
            termina(true, true);
            return;
        }

        try {
            proiezione = gestore.getMediaProjection(risultato, dati);
            final String idRichiesta = nuovaSessione;
            proiezione.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    if (lavoro != null) lavoro.post(() -> terminaSe(idRichiesta, true));
                }
            }, lavoro);

            int[] misura = misuraSchermo();
            int larghezza = misura[0];
            int altezza = misura[1];
            int densita = misura[2];
            lettore = ImageReader.newInstance(larghezza, altezza, PixelFormat.RGBA_8888, 2);
            lettore.setOnImageAvailableListener(this::fotogrammaDisponibile, lavoro);
            schermoVirtuale = proiezione.createVirtualDisplay(
                "PulseTalkScreen",
                larghezza,
                altezza,
                densita,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                lettore.getSurface(),
                null,
                lavoro
            );
        } catch (RuntimeException errore) {
            termina(true, true);
        }
    }

    private int[] misuraSchermo() {
        int larghezza;
        int altezza;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowManager finestre = getSystemService(WindowManager.class);
            Rect limiti = finestre.getMaximumWindowMetrics().getBounds();
            larghezza = limiti.width();
            altezza = limiti.height();
        } else {
            DisplayMetrics metriche = new DisplayMetrics();
            WindowManager finestre = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            finestre.getDefaultDisplay().getRealMetrics(metriche);
            larghezza = metriche.widthPixels;
            altezza = metriche.heightPixels;
        }
        int densita = getResources().getConfiguration().densityDpi;
        return new int[] { Math.max(1, larghezza), Math.max(1, altezza), Math.max(1, densita) };
    }

    private void fotogrammaDisponibile(ImageReader sorgente) {
        Image immagine = null;
        try {
            immagine = sorgente.acquireLatestImage();
            if (immagine == null || sessione == null) return;
            long adesso = android.os.SystemClock.elapsedRealtime();
            if (adesso - ultimoFotogramma < intervalloMs) return;
            ultimoFotogramma = adesso;
            codifica(immagine, sessione);
        } catch (RuntimeException ignorato) {
            // Un fotogramma malformato non deve terminare la condivisione.
        } finally {
            if (immagine != null) immagine.close();
        }
    }

    private void codifica(Image immagine, String idSessione) {
        Image.Plane piano = immagine.getPlanes()[0];
        ByteBuffer pixel = piano.getBuffer();
        int larghezza = immagine.getWidth();
        int altezza = immagine.getHeight();
        int passoPixel = piano.getPixelStride();
        int passoRiga = piano.getRowStride();
        int riempimento = Math.max(0, passoRiga - passoPixel * larghezza);
        int larghezzaPiena = larghezza + riempimento / passoPixel;

        Bitmap piena = Bitmap.createBitmap(larghezzaPiena, altezza, Bitmap.Config.ARGB_8888);
        pixel.rewind();
        piena.copyPixelsFromBuffer(pixel);
        Bitmap ritaglio = Bitmap.createBitmap(piena, 0, 0, larghezza, altezza);

        float scala = Math.min(1f, latoMassimo / (float) Math.max(larghezza, altezza));
        int uscitaLarghezza = Math.max(1, Math.round(larghezza * scala));
        int uscitaAltezza = Math.max(1, Math.round(altezza * scala));
        Bitmap uscita = scala < 1f
            ? Bitmap.createScaledBitmap(ritaglio, uscitaLarghezza, uscitaAltezza, true)
            : ritaglio;

        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        uscita.compress(Bitmap.CompressFormat.JPEG, 72, bytes);
        String base64 = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        PulseTalkCallPlugin.pubblicaFotogramma(
            idSessione,
            base64,
            uscitaLarghezza,
            uscitaAltezza
        );

        if (uscita != ritaglio) uscita.recycle();
        if (ritaglio != piena) ritaglio.recycle();
        piena.recycle();
    }

    private void terminaSe(String idSessione, boolean dalSistema) {
        if (idSessione == null || !idSessione.equals(sessione)) return;
        termina(dalSistema, true);
    }

    private void termina(boolean notifica, boolean fermaServizio) {
        String vecchiaSessione = sessione;
        sessione = null;

        if (lettore != null) {
            lettore.setOnImageAvailableListener(null, null);
            lettore.close();
            lettore = null;
        }
        if (schermoVirtuale != null) {
            schermoVirtuale.release();
            schermoVirtuale = null;
        }
        if (proiezione != null) {
            MediaProjection vecchia = proiezione;
            proiezione = null;
            vecchia.stop();
        }
        if (notifica && vecchiaSessione != null) {
            PulseTalkCallPlugin.condivisioneTerminata(vecchiaSessione);
        }
        if (fermaServizio) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        termina(false, false);
        if (filo != null) filo.quitSafely();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
