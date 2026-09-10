package com.hjsolution.suha.driver;

import android.media.MediaMetadataRetriever;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import static org.junit.Assert.*;

/** Checks actual bundled media with the phone decoder without opening the camera or unlocking the screen. */
@RunWith(AndroidJUnit4.class)
public class BundledVideoDecodeTest {
    @Test public void allBundledWarningVideosDecodeOnDevice() throws Exception {
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        File temporary=File.createTempFile("warning-media-check-", ".mp4", context.getCacheDir());
        try {
            for(int i=0;i<=10;i++) {
                String asset="public/media/drowsy-video-"+i+".mp4";
                try(var input=context.getAssets().open(asset);var output=new FileOutputStream(temporary)) {
                    byte[] buffer=new byte[65536]; int count;
                    while((count=input.read(buffer))!=-1) output.write(buffer,0,count);
                }
                try(var media=new MediaMetadataRetriever()) {
                    media.setDataSource(temporary.getAbsolutePath());
                    long duration=Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
                    assertTrue(asset+" has positive duration",duration>0);
                    var first=media.getFrameAtTime(0,MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                    assertNotNull(asset+" frame decodes",first);
                    assertTrue(first.getWidth()>0 && first.getHeight()>0);
                    first.recycle();
                    System.out.println("VIDEO_DECODE: "+i+" OK durationMs="+duration);
                }
            }
        } finally { assertTrue("Remove test-only media copy",temporary.delete()); }
    }
}
