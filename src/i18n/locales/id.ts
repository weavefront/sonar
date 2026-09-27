import type { Messages, PluralMessages } from '../types';

export const id: Messages = {
  'common.cancel': 'Batal',
  'common.continue': 'Lanjutkan',
  'common.close': 'Tutup',
  'common.copied': 'Tersalin',
  'common.or': 'atau',
  'common.creating': 'Membuat…',
  'common.confirmCreate': 'Konfirmasi dan buat',
  'common.decrypting': 'Mendekripsi…',
  'common.stillConfirming':
    'Terunggah — masih dikonfirmasi di Arweave. Ini bisa memakan waktu beberapa menit.',

  'app.notFound': 'Halaman tidak ditemukan.',
  'app.tagline': 'Peramban berkas yang cepat untuk Arweave',
  'shell.watching': 'hanya melihat',
  'shell.exit': 'Keluar',
  'theme.switchToLight': 'Beralih ke tema terang',
  'theme.switchToDark': 'Beralih ke tema gelap',
  'language.label': 'Bahasa',

  'modal.estimatingCost': 'Memperkirakan biaya…',
  'modal.cost': 'Biaya: {amount}',

  'connect.newToArweave': 'Baru mengenal Arweave?',
  'connect.newToArweaveBody':
    'Dapatkan dompet dalam satu langkah — tanpa pendaftaran, tanpa email. Anda akan menerima frasa pemulihan dan berkas kunci; simpan salah satunya dengan aman dan Anda sudah menjadi pengguna Sonar.',
  'connect.createWallet': 'Buat dompet baru',
  'connect.alreadyHaveWallet': 'Sudah punya dompet?',
  'connect.alreadyHaveWalletBody':
    'Berkas ArDrive Anda yang sudah ada akan muncul di sini — Sonar membaca data ArFS yang sama.',
  'connect.connecting': 'Menghubungkan…',
  'connect.connectExtension': 'Hubungkan ekstensi dompet',
  'connect.connectWander': 'Hubungkan Wander',
  'connect.noExtension':
    'Tidak ada ekstensi yang terdeteksi. {link}, atau gunakan salah satu opsi di bawah.',
  'connect.installWander': 'Pasang Wander',
  'connect.useKeyFile': 'Gunakan berkas kunci',
  'connect.keyFileNote':
    'Hanya baca: alamat diturunkan di peramban Anda dan kuncinya langsung dibuang.',
  'connect.viewAnyAddress': 'Atau lihat alamat mana pun',
  'connect.addressPlaceholder': 'Alamat Arweave 43 karakter',
  'connect.view': 'Lihat',
  'connect.privateDrivesNote':
    'Drive privat juga berfungsi — masukkan kata sandi drive untuk menjelajah, melihat pratinjau, dan menulis ke dalamnya selama sesi ini. Tidak ada yang pernah disimpan.',

  'driveList.title': 'Drive Anda',
  'driveList.searching': 'mencari…',
  'driveList.newDrive': 'Drive baru',
  'driveList.refresh': 'Muat ulang',
  'driveList.loading': 'Memuat drive',
  'driveList.empty': 'Tidak ada drive ditemukan',
  'driveList.emptyBody':
    'Alamat ini belum memiliki drive ArFS, atau drive tersebut belum terindeks.',
  'driveList.createdWithVersion': 'Dibuat {date} · ArFS {version}',
  'driveList.privateDrives': 'Drive privat',
  'driveList.unlockedCreated': 'Terbuka pada sesi ini · dibuat {date}',
  'driveList.encryptedCreated': 'Terenkripsi · dibuat {date}',
  'driveList.open': 'Buka',
  'driveList.unlock': 'Buka kunci',
  'driveList.needsSigning': 'Perlu tanda tangan',
  'driveList.privateHintCanSign':
    'Masukkan kata sandi drive untuk mendekripsi dan menjelajahinya selama sesi ini — tidak ada yang disimpan.',
  'driveList.privateHintWatchOnly':
    'Hubungkan dompet yang dapat menandatangani (bukan hanya melihat) untuk membuka kunci drive privat.',

  'driveBrowser.privateCantShare': 'Drive ini privat dan tidak dapat dibagikan.',
  'driveBrowser.notPartOfShare': 'Folder ini bukan bagian dari tautan berbagi ini.',
  'driveBrowser.goToParent': 'Ke folder induk',
  'driveBrowser.sharedFolder': 'Folder yang dibagikan',
  'driveBrowser.drive': 'Drive',
  'driveBrowser.folder': 'Folder',
  'driveBrowser.shareFolder': 'Bagikan folder ini',
  'driveBrowser.resync': 'Sinkronkan ulang drive',
  'driveBrowser.resyncTitle': 'Sinkronkan ulang dari jaringan',
  'driveBrowser.search': 'Cari di drive ini',
  'driveBrowser.sortBy': 'Urutkan menurut',
  'driveBrowser.sortName': 'Nama',
  'driveBrowser.sortSize': 'Ukuran',
  'driveBrowser.sortModified': 'Diubah',
  'driveBrowser.sortAscending': 'Urutkan menaik',
  'driveBrowser.sortDescending': 'Urutkan menurun',
  'driveBrowser.readOnlyBanner': 'Folder yang dibagikan · hanya baca',
  'driveBrowser.noMatches': 'Tidak ada yang cocok dengan “{query}”.',
  'driveBrowser.emptyFolder': 'Folder ini kosong.',
  'driveBrowser.loadingDrive': 'Memuat drive ini…',
  'driveBrowser.breadcrumb': 'Jejak navigasi',
  'driveBrowser.listView': 'Tampilan daftar',
  'driveBrowser.iconView': 'Tampilan ikon',
  'driveBrowser.denseView': 'Tampilan padat',
  'driveBrowser.layout': 'Tata letak',
  'driveBrowser.tilesSmall': 'Ubin kecil',
  'driveBrowser.tilesMedium': 'Ubin sedang',
  'driveBrowser.tilesLarge': 'Ubin besar',
  'driveBrowser.tileSize': 'Ukuran ubin',
  'driveBrowser.checkingUpdates': 'memeriksa pembaruan',
  'driveBrowser.syncing': 'menyinkronkan {resolved}/{found}',
  'driveBrowser.syncFailed': 'sinkronisasi gagal — menampilkan data tersimpan',
  'driveBrowser.orphanedTitle': 'Entitas yang folder induknya tidak ditemukan',
  'driveBrowser.showHidden': 'Tampilkan yang tersembunyi',
  'driveBrowser.hideHidden': 'Sembunyikan yang tersembunyi',
  'driveBrowser.unresolvedMeta': 'Metadata tidak dapat diambil dari gerbang',
  'driveBrowser.encrypted': 'terenkripsi',
  'driveBrowser.folderWithDate': 'Folder · {date}',
  'driveBrowser.processingTitle':
    'Terunggah, tetapi belum dikonfirmasi di Arweave — ini bisa memakan waktu beberapa menit.',
  'driveBrowser.processing': 'Memproses',
  'driveBrowser.details': 'Detail',

  'details.forFile': 'Detail untuk {name}',
  'details.close': 'Tutup detail',
  'details.viewExpanded': 'Lihat diperbesar',
  'details.preparingDownload': 'Menyiapkan unduhan…',
  'details.download': 'Unduh',
  'details.copyLink': 'Salin tautan',
  'details.copyValue': 'Salin {label}',
  'details.downloadError': 'Tidak dapat mengunduh berkas ini: {error}',
  'details.size': 'Ukuran',
  'details.type': 'Jenis',
  'details.modified': 'Diubah',
  'details.uploaded': 'Diunggah',
  'details.path': 'Jalur',
  'details.fileId': 'ID berkas',
  'details.dataTx': 'TX data',
  'details.metadataTx': 'TX metadata',
  'details.block': 'Blok',
  'details.arfs': 'ArFS',
  'details.pinnedFrom': 'Disematkan dari',
  'details.versionHistory': 'Riwayat versi',
  'details.current': 'saat ini',
  'details.encryptedTag': '(terenkripsi)',

  'rowMenu.moreActions': 'Tindakan lain',
  'rowMenu.rename': 'Ganti nama',
  'rowMenu.move': 'Pindahkan',
  'rowMenu.hide': 'Sembunyikan',
  'rowMenu.unhide': 'Tampilkan',

  'hide.hideFileTitle': 'Sembunyikan berkas',
  'hide.hideFolderTitle': 'Sembunyikan folder',
  'hide.unhideFileTitle': 'Tampilkan berkas',
  'hide.unhideFolderTitle': 'Tampilkan folder',
  'hide.willHide':
    '“{name}” akan disembunyikan dari penjelajahan biasa (tetap terlihat jika “Tampilkan yang tersembunyi” aktif, dan selalu dapat dibaca langsung dari transaksinya).',
  'hide.willUnhide': '“{name}” akan muncul kembali dalam penjelajahan biasa.',
  'hide.saving': 'Menyimpan…',
  'hide.confirmHide': 'Konfirmasi dan sembunyikan',
  'hide.confirmUnhide': 'Konfirmasi dan tampilkan',

  'createDrive.title': 'Drive baru',
  'createDrive.name': 'Nama drive',
  'createDrive.namePlaceholder': 'Drive Saya',
  'createDrive.makePrivate': 'Jadikan drive ini privat',
  'createDrive.password': 'Kata sandi',
  'createDrive.confirmPassword': 'Konfirmasi kata sandi',
  'createDrive.passwordMismatch': 'Kata sandi tidak cocok.',
  'createDrive.noRecovery':
    'Tidak ada pemulihan kata sandi. Jika Anda kehilangan kata sandi ini, isi drive ini hilang selamanya — tidak seorang pun, termasuk kami, dapat mengembalikannya.',

  'createFolder.title': 'Folder baru',
  'createFolder.name': 'Nama folder',
  'createFolder.namePlaceholder': 'Folder baru',

  'createWallet.title': 'Buat dompet baru',
  'createWallet.generating': 'Membuat dompet Anda…',
  'createWallet.generatingNote':
    'Ini bisa memakan waktu hingga dua menit — peramban Anda sedang menghasilkan materi kunci asli yang kompatibel dengan Arweave. Biarkan tab ini tetap terbuka.',
  'createWallet.error': 'Tidak dapat membuat dompet: {error}',
  'createWallet.phraseLabel': 'Frasa pemulihan 12 kata Anda',
  'createWallet.copyPhrase': 'Salin frasa',
  'createWallet.downloadKeyfile': 'Unduh berkas kunci',
  'createWallet.warning':
    'Ini satu-satunya salinan. Jika hilang, dompet ini dan semua isinya hilang selamanya — tidak seorang pun, termasuk kami, dapat mengembalikannya. Sonar tidak pernah menyimpannya.',
  'createWallet.confirmSaved': 'Saya sudah menyimpan frasa pemulihan atau berkas kunci saya',
  'createWallet.continuing': 'Melanjutkan…',
  'createWallet.continueToApp': 'Lanjutkan ke Sonar',

  'rename.fileTitle': 'Ganti nama berkas',
  'rename.folderTitle': 'Ganti nama folder',
  'rename.renaming': 'Mengganti nama…',
  'rename.confirm': 'Konfirmasi dan ganti nama',
  'move.title': 'Pindahkan {name}',
  'move.destination': 'Folder tujuan',
  'move.moving': 'Memindahkan…',
  'move.confirm': 'Konfirmasi dan pindahkan',

  'password.title': 'Buka kunci drive privat',
  'password.prompt': 'Masukkan kata sandi untuk {name}.',
  'password.placeholder': 'Kata sandi drive',
  'password.wrong': 'Kata sandi itu tidak cocok dengan drive ini.',
  'password.technicalDetails': 'Detail teknis',
  'password.unlocking': 'Membuka kunci…',
  'password.unlock': 'Buka kunci',

  'share.title': 'Bagikan “{name}”',
  'share.whatToInclude': 'Apa yang disertakan',
  'share.thisFolderAndSubfolders': 'Folder ini dan subfoldernya',
  'share.justThisFolder': 'Hanya folder ini',
  'share.link': 'Tautan',
  'share.copy': 'Salin',
  'share.noteWithSubfolders':
    'Siapa pun yang memiliki tautan ini dapat melihat dan mengunduh folder ini beserta seluruh isinya — tanpa akun atau dompet. Data ini sudah publik di Arweave; tautan ini hanya mengarahkan langsung ke sana.',
  'share.noteFolderOnly':
    'Siapa pun yang memiliki tautan ini dapat melihat dan mengunduh berkas yang berada langsung di folder ini — tanpa akun atau dompet. Data ini sudah publik di Arweave; tautan ini hanya mengarahkan langsung ke sana.',
  'shareRoute.invalid': 'Tautan berbagi ini tidak valid.',

  'upload.dropToUpload': 'Lepaskan untuk mengunggah',
  'upload.uploadFiles': 'Unggah berkas',
  'upload.uploadFolder': 'Unggah folder',
  'upload.newFolder': 'Folder baru',
  'upload.panelTitle': 'Unggahan',
  'upload.clearFinished': 'Bersihkan yang selesai',
  'upload.estimating': 'Memperkirakan…',
  'upload.uploading': 'Mengunggah…',
  'upload.done': 'Selesai',
  'upload.remove': 'Hapus {name}',
  'upload.total': 'Total: {amount}',

  'download.selectAll': 'Pilih semua',
  'download.selectItem': 'Pilih {name}',
  'download.downloadAll': 'Unduh semua',
  'download.waitForLoad': 'Tersedia setelah folder ini selesai dimuat',
  'download.panelTitle': 'Unduhan',
  'download.collecting': 'Menyiapkan…',
  'download.fetchingProgress': 'Mengunduh {completed} dari {total} berkas…',
  'download.saving': 'Menyimpan…',
  'download.done': 'Selesai',
  'download.partialFailure': '{succeeded} dari {total} berkas berhasil diunduh — sisanya gagal.',

  'preview.locked': 'Drive ini terkunci pada sesi ini.',
  'preview.noDataTx':
    'Tidak ada transaksi data — metadata berkas ini tidak menunjuk ke konten apa pun.',
  'preview.decryptError': 'Tidak dapat mendekripsi berkas ini: {error}',
  'preview.noInlinePreview': 'Tidak ada pratinjau untuk jenis berkas ini.',
  'preview.tooLarge': 'Terlalu besar untuk pratinjau ({size}).',
  'preview.loadError': 'Tidak dapat memuat pratinjau: {error}',
  'lightbox.close': 'Tutup tampilan diperbesar',
  'lightbox.loadError': 'Tidak dapat memuat gambar ini: {error}',

  'turbo.balanceUnavailable': 'Saldo tidak tersedia',
  'turbo.loadingBalance': 'Memuat saldo…',
  'turbo.enableUploads': 'Aktifkan unggahan',
  'turbo.wrongKeyFile':
    'Berkas kunci itu milik alamat lain — pilih berkas aslinya untuk mengaktifkan unggahan di sini.',

  'error.watchOnlySession':
    'Ini sesi hanya-melihat — hubungkan dompet yang dapat menandatangani untuk membuat perubahan.',
  'error.signingUnavailable':
    'Penandatanganan tidak tersedia pada sesi ini. Hubungkan ulang dompet Anda untuk melanjutkan.',
  'error.extensionGone':
    'Ekstensi dompet tidak lagi tersedia. Hubungkan ulang untuk melanjutkan.',
  'error.keyFileNotLoaded':
    'Berkas kunci Anda belum dimuat pada sesi ini — pilih lagi untuk melanjutkan.',
  'error.cannotSign':
    'Sesi ini tidak dapat menandatangani — hubungkan dompet yang dapat melakukannya.',
  'error.insufficientCredits':
    'Kredit Turbo tidak cukup untuk unggahan ini. Isi ulang saldo Anda dan coba lagi.',
  'error.signingRejected': 'Penandatanganan ditolak di dompet Anda.',
  'error.noExtension':
    'Tidak ditemukan ekstensi dompet Arweave. Pasang Wander untuk menghubungkan.',
  'error.badAddress':
    'Itu tidak tampak seperti alamat Arweave (43 karakter, A–Z a–z 0–9 _ -).',
  'error.notKeyFile': 'Bukan berkas kunci Arweave: modulus “n” tidak ada.',
  'error.connectToUnlock':
    'Hubungkan dompet yang dapat menandatangani untuk membuka kunci drive privat.',
  'error.decryptionFailed': 'Dekripsi gagal — periksa kata sandi drive.',
  'error.sessionCannotSign':
    'Sesi ini tidak dapat menandatangani — hubungkan dompet yang dapat melakukannya.',
  'error.extensionUnavailable': 'Ekstensi dompet tidak tersedia.',
  'error.keyFileNotInSession': 'Berkas kunci belum dimuat pada sesi ini.',
  'error.bridgeUnavailable':
    'Tidak dapat mengambil data tanda tangan drive ini dari jaringan. Ini masalah gerbang/jaringan, bukan kata sandi yang salah — silakan coba lagi sebentar lagi.',
  'error.estimateFailed': 'Tidak dapat memperkirakan biaya unggahan.',
  'error.readKeyFile': 'Tidak dapat membaca berkas kunci: {message}',
  'error.walletCantSign':
    'Dompet Anda tidak dapat menandatangani permintaan ini ({message}). Jika dompet Anda telah menghapus dukungan penandatanganan lama, ini memerlukan pembaruan SDK — mencoba lagi tidak akan memperbaikinya.',
};

/** Indonesian has a single grammatical plural form, so only `other` is needed. */
export const idPlurals: PluralMessages = {
  items: { other: '{count} item' },
  matches: { other: '{count} kecocokan' },
  revisions: { other: '{count} revisi' },
  orphaned: { other: '{count} yatim' },
  confirmUpload: { other: 'Konfirmasi dan unggah {count} berkas' },
  confirmDownload: { other: 'Unduh {count} item' },
};
