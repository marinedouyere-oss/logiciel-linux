package com.marinedouyere.orion.ui.calepinage

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns

fun displayNameOf(context: Context, uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (idx >= 0 && cursor.moveToFirst()) return cursor.getString(idx) ?: uri.lastPathSegment.orEmpty()
    }
    return uri.lastPathSegment ?: "fichier"
}
