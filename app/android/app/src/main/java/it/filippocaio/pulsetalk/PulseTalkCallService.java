package it.filippocaio.pulsetalk;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/** Mantiene il processo WebRTC in primo piano mentre la chiamata e' attiva. */
public class PulseTalkCallService extends Service {
    public static final String AZIONE_AVVIA = "pulsetalk.chiamata.AVVIA";
    public static final String AZIONE_FERMA = "pulsetalk.chiamata.FERMA";
    public static final String EXTRA_CANALE = "canale";
    private static final String CANALE_NOTIFICA = "chiamate";
    private static final int ID_NOTIFICA = 714;

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel canale = new NotificationChannel(
                CANALE_NOTIFICA,
                "Chiamate in corso",
                NotificationManager.IMPORTANCE_LOW
            );
            canale.setDescription("Mantiene attive voce e video quando PulseTalk e' in secondo piano");
            getSystemService(NotificationManager.class).createNotificationChannel(canale);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && AZIONE_FERMA.equals(intent.getAction())) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        String canale = intent == null ? "Chiamata" : intent.getStringExtra(EXTRA_CANALE);
        Intent apri = new Intent(this, MainActivity.class).setFlags(
            Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );
        PendingIntent contenuto = PendingIntent.getActivity(
            this,
            0,
            apri,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Notification notifica = new NotificationCompat.Builder(this, CANALE_NOTIFICA)
            .setSmallIcon(R.drawable.ic_stat_pulsetalk)
            .setContentTitle("PulseTalk — chiamata in corso")
            .setContentText(canale == null ? "Chiamata" : canale)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(contenuto)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();

        int tipi = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            tipi |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        }
        ServiceCompat.startForeground(this, ID_NOTIFICA, notifica, tipi);
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
