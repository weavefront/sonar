import type { Messages, PluralMessages } from '../types';

export const tr: Messages = {
  'common.cancel': 'İptal',
  'common.continue': 'Devam et',
  'common.close': 'Kapat',
  'common.copied': 'Kopyalandı',
  'common.or': 'veya',
  'common.creating': 'Oluşturuluyor…',
  'common.confirmCreate': 'Onayla ve oluştur',
  'common.decrypting': 'Şifre çözülüyor…',
  'common.stillConfirming':
    'Yüklendi — Arweave üzerinde hâlâ onaylanıyor. Bu birkaç dakika sürebilir.',

  'app.notFound': 'Sayfa bulunamadı.',
  'app.tagline': "Arweave için hızlı bir dosya tarayıcısı",
  'shell.watching': 'izleniyor',
  'shell.exit': 'Çıkış',
  'theme.switchToLight': 'Açık temaya geç',
  'theme.switchToDark': 'Koyu temaya geç',
  'language.label': 'Dil',

  'modal.estimatingCost': 'Maliyet hesaplanıyor…',
  'modal.cost': 'Maliyet: {amount}',

  'connect.newToArweave': "Arweave'de yeni misiniz?",
  'connect.newToArweaveBody':
    'Tek adımda cüzdan edinin — kayıt yok, e-posta yok. Bir kurtarma ifadesi ve bir anahtar dosyası alacaksınız; ikisinden birini güvende tutun, artık bir Sonar kullanıcısısınız.',
  'connect.createWallet': 'Yeni cüzdan oluştur',
  'connect.alreadyHaveWallet': 'Zaten cüzdanınız var mı?',
  'connect.alreadyHaveWalletBody':
    'Mevcut ArDrive dosyalarınız burada görünür — Sonar aynı ArFS verilerini okur.',
  'connect.connecting': 'Bağlanıyor…',
  'connect.connectExtension': 'Cüzdan eklentisini bağla',
  'connect.connectWander': "Wander'ı bağla",
  'connect.noExtension': 'Eklenti bulunamadı. {link}, ya da aşağıdaki seçeneklerden birini kullanın.',
  'connect.installWander': "Wander'ı yükleyin",
  'connect.useKeyFile': 'Anahtar dosyası kullan',
  'connect.keyFileNote':
    'Salt okunur: adres tarayıcınızda türetilir ve anahtar hemen atılır.',
  'connect.viewAnyAddress': 'Ya da herhangi bir adresi görüntüleyin',
  'connect.addressPlaceholder': '43 karakterlik Arweave adresi',
  'connect.view': 'Görüntüle',
  'connect.privateDrivesNote':
    'Özel sürücüler de çalışır — bu oturum boyunca göz atmak, önizlemek ve yazmak için bir sürücünün parolasını girin. Hiçbir şey kaydedilmez.',

  'driveList.title': 'Sürücüleriniz',
  'driveList.searching': 'aranıyor…',
  'driveList.newDrive': 'Yeni sürücü',
  'driveList.refresh': 'Yenile',
  'driveList.loading': 'Sürücüler yükleniyor',
  'driveList.empty': 'Sürücü bulunamadı',
  'driveList.emptyBody':
    'Bu adrese ait henüz bir ArFS sürücüsü yok ya da henüz dizine eklenmemişler.',
  'driveList.createdWithVersion': 'Oluşturuldu {date} · ArFS {version}',
  'driveList.privateDrives': 'Özel sürücüler',
  'driveList.unlockedCreated': 'Bu oturumda kilidi açıldı · oluşturuldu {date}',
  'driveList.encryptedCreated': 'Şifreli · oluşturuldu {date}',
  'driveList.open': 'Aç',
  'driveList.unlock': 'Kilidi aç',
  'driveList.needsSigning': 'İmza gerekiyor',
  'driveList.privateHintCanSign':
    'Bu oturum boyunca şifresini çözüp göz atmak için bir sürücünün parolasını girin — hiçbir şey kaydedilmez.',
  'driveList.privateHintWatchOnly':
    'Özel bir sürücünün kilidini açmak için imzalayabilen (salt izleme olmayan) bir cüzdan bağlayın.',

  'driveBrowser.privateCantShare': 'Bu sürücü özeldir ve paylaşılamaz.',
  'driveBrowser.notPartOfShare': 'Bu klasör bu paylaşım bağlantısının parçası değil.',
  'driveBrowser.goToParent': 'Üst klasöre git',
  'driveBrowser.sharedFolder': 'Paylaşılan klasör',
  'driveBrowser.drive': 'Sürücü',
  'driveBrowser.folder': 'Klasör',
  'driveBrowser.shareFolder': 'Bu klasörü paylaş',
  'driveBrowser.resync': 'Sürücüyü yeniden eşitle',
  'driveBrowser.resyncTitle': 'Ağdan yeniden eşitle',
  'driveBrowser.search': 'Bu sürücüde ara',
  'driveBrowser.sortBy': 'Sıralama ölçütü',
  'driveBrowser.sortName': 'Ad',
  'driveBrowser.sortSize': 'Boyut',
  'driveBrowser.sortModified': 'Değiştirilme',
  'driveBrowser.sortAscending': 'Artan sırala',
  'driveBrowser.sortDescending': 'Azalan sırala',
  'driveBrowser.readOnlyBanner': 'Paylaşılan klasör · salt okunur',
  'driveBrowser.noMatches': '“{query}” ile eşleşen bir şey yok.',
  'driveBrowser.emptyFolder': 'Bu klasör boş.',
  'driveBrowser.loadingDrive': 'Bu sürücü yükleniyor…',
  'driveBrowser.breadcrumb': 'Gezinme yolu',
  'driveBrowser.listView': 'Liste görünümü',
  'driveBrowser.iconView': 'Simge görünümü',
  'driveBrowser.denseView': 'Sık görünüm',
  'driveBrowser.layout': 'Düzen',
  'driveBrowser.tilesSmall': 'Küçük döşemeler',
  'driveBrowser.tilesMedium': 'Orta döşemeler',
  'driveBrowser.tilesLarge': 'Büyük döşemeler',
  'driveBrowser.tileSize': 'Döşeme boyutu',
  'driveBrowser.checkingUpdates': 'güncellemeler denetleniyor',
  'driveBrowser.syncing': 'eşitleniyor {resolved}/{found}',
  'driveBrowser.syncFailed': 'eşitleme başarısız — önbellekteki veriler gösteriliyor',
  'driveBrowser.orphanedTitle': 'Üst klasörü bulunamayan ögeler',
  'driveBrowser.showHidden': 'Gizlileri göster',
  'driveBrowser.hideHidden': 'Gizlileri gizle',
  'driveBrowser.unresolvedMeta': 'Üst veriler ağ geçidinden alınamadı',
  'driveBrowser.encrypted': 'şifreli',
  'driveBrowser.folderWithDate': 'Klasör · {date}',
  'driveBrowser.processingTitle':
    'Yüklendi ama Arweave üzerinde henüz onaylanmadı — bu birkaç dakika sürebilir.',
  'driveBrowser.processing': 'İşleniyor',
  'driveBrowser.details': 'Ayrıntılar',

  'details.forFile': '{name} ayrıntıları',
  'details.close': 'Ayrıntıları kapat',
  'details.viewExpanded': 'Büyütülmüş görüntüle',
  'details.preparingDownload': 'İndirme hazırlanıyor…',
  'details.download': 'İndir',
  'details.copyLink': 'Bağlantıyı kopyala',
  'details.copyValue': '{label} kopyala',
  'details.downloadError': 'Bu dosya indirilemedi: {error}',
  'details.size': 'Boyut',
  'details.type': 'Tür',
  'details.modified': 'Değiştirilme',
  'details.uploaded': 'Yüklenme',
  'details.path': 'Yol',
  'details.fileId': 'Dosya kimliği',
  'details.dataTx': 'Veri TX',
  'details.metadataTx': 'Üst veri TX',
  'details.block': 'Blok',
  'details.arfs': 'ArFS',
  'details.pinnedFrom': 'Sabitlendiği yer',
  'details.versionHistory': 'Sürüm geçmişi',
  'details.current': 'geçerli',
  'details.encryptedTag': '(şifreli)',

  'rowMenu.moreActions': 'Diğer eylemler',
  'rowMenu.rename': 'Yeniden adlandır',
  'rowMenu.move': 'Taşı',
  'rowMenu.hide': 'Gizle',
  'rowMenu.unhide': 'Göster',

  'hide.hideFileTitle': 'Dosyayı gizle',
  'hide.hideFolderTitle': 'Klasörü gizle',
  'hide.unhideFileTitle': 'Dosyayı göster',
  'hide.unhideFolderTitle': 'Klasörü göster',
  'hide.willHide':
    '“{name}” normal gezinmede gizlenecek (“Gizlileri göster” açıkken yine görünür ve işleminden her zaman doğrudan okunabilir).',
  'hide.willUnhide': '“{name}” normal gezinmede yeniden görünecek.',
  'hide.saving': 'Kaydediliyor…',
  'hide.confirmHide': 'Onayla ve gizle',
  'hide.confirmUnhide': 'Onayla ve göster',

  'createDrive.title': 'Yeni sürücü',
  'createDrive.name': 'Sürücü adı',
  'createDrive.namePlaceholder': 'Sürücüm',
  'createDrive.makePrivate': 'Bu sürücüyü özel yap',
  'createDrive.password': 'Parola',
  'createDrive.confirmPassword': 'Parolayı doğrula',
  'createDrive.passwordMismatch': 'Parolalar eşleşmiyor.',
  'createDrive.noRecovery':
    'Parola kurtarma yoktur. Bu parolayı kaybederseniz bu sürücünün içeriği sonsuza dek kaybolur — biz dâhil hiç kimse geri getiremez.',

  'createFolder.title': 'Yeni klasör',
  'createFolder.name': 'Klasör adı',
  'createFolder.namePlaceholder': 'Yeni klasör',

  'createWallet.title': 'Yeni cüzdan oluştur',
  'createWallet.generating': 'Cüzdanınız oluşturuluyor…',
  'createWallet.generatingNote':
    'Bu iki dakikaya kadar sürebilir — tarayıcınız gerçek, Arweave uyumlu anahtar materyali üretiyor. Lütfen bu sekmeyi açık tutun.',
  'createWallet.error': 'Cüzdan oluşturulamadı: {error}',
  'createWallet.phraseLabel': '12 kelimelik kurtarma ifadeniz',
  'createWallet.copyPhrase': 'İfadeyi kopyala',
  'createWallet.downloadKeyfile': 'Anahtar dosyasını indir',
  'createWallet.warning':
    'Bu tek kopyadır. Kaybederseniz bu cüzdan ve içindeki her şey sonsuza dek kaybolur — biz dâhil hiç kimse geri getiremez. Sonar bunu asla saklamaz.',
  'createWallet.confirmSaved': 'Kurtarma ifademi veya anahtar dosyamı kaydettim',
  'createWallet.continuing': 'Devam ediliyor…',
  'createWallet.continueToApp': "Sonar'a devam et",

  'rename.fileTitle': 'Dosyayı yeniden adlandır',
  'rename.folderTitle': 'Klasörü yeniden adlandır',
  'rename.renaming': 'Yeniden adlandırılıyor…',
  'rename.confirm': 'Onayla ve yeniden adlandır',
  'move.title': '{name} taşınıyor',
  'move.destination': 'Hedef klasör',
  'move.moving': 'Taşınıyor…',
  'move.confirm': 'Onayla ve taşı',

  'password.title': 'Özel sürücünün kilidini aç',
  'password.prompt': '{name} için parolayı girin.',
  'password.placeholder': 'Sürücü parolası',
  'password.wrong': 'Bu parola bu sürücüyle eşleşmiyor.',
  'password.technicalDetails': 'Teknik ayrıntılar',
  'password.unlocking': 'Kilit açılıyor…',
  'password.unlock': 'Kilidi aç',

  'share.title': '“{name}” paylaşılıyor',
  'share.whatToInclude': 'Neler dâhil edilsin',
  'share.thisFolderAndSubfolders': 'Bu klasör ve alt klasörleri',
  'share.justThisFolder': 'Yalnızca bu klasör',
  'share.link': 'Bağlantı',
  'share.copy': 'Kopyala',
  'share.noteWithSubfolders':
    'Bu bağlantıya sahip herkes bu klasörü ve içindeki her şeyi görüntüleyip indirebilir — hesap ya da cüzdan gerekmez. Bu veriler Arweave üzerinde zaten herkese açık; bağlantı yalnızca doğrudan oraya götürür.',
  'share.noteFolderOnly':
    'Bu bağlantıya sahip herkes doğrudan bu klasördeki dosyaları görüntüleyip indirebilir — hesap ya da cüzdan gerekmez. Bu veriler Arweave üzerinde zaten herkese açık; bağlantı yalnızca doğrudan oraya götürür.',
  'shareRoute.invalid': 'Bu paylaşım bağlantısı geçersiz.',

  'upload.dropToUpload': 'Yüklemek için bırakın',
  'upload.uploadFiles': 'Dosya yükle',
  'upload.uploadFolder': 'Klasör yükle',
  'upload.newFolder': 'Yeni klasör',
  'upload.panelTitle': 'Yüklemeler',
  'upload.clearFinished': 'Tamamlananları temizle',
  'upload.estimating': 'Hesaplanıyor…',
  'upload.uploading': 'Yükleniyor…',
  'upload.done': 'Tamamlandı',
  'upload.remove': '{name} ögesini kaldır',
  'upload.total': 'Toplam: {amount}',

  'download.selectAll': 'Tümünü seç',
  'download.selectItem': '{name} öğesini seç',
  'download.panelTitle': 'İndirmeler',
  'download.collecting': 'Hazırlanıyor…',
  'download.fetchingProgress': '{total} dosyadan {completed} tanesi indiriliyor…',
  'download.saving': 'Kaydediliyor…',
  'download.done': 'Tamamlandı',
  'download.partialFailure': '{total} dosyadan {succeeded} tanesi indirildi — kalanlar başarısız oldu.',

  'preview.locked': 'Bu sürücü bu oturumda kilitli.',
  'preview.noDataTx':
    'Veri işlemi yok — bu dosyanın üst verileri herhangi bir içeriğe işaret etmiyor.',
  'preview.decryptError': 'Bu dosyanın şifresi çözülemedi: {error}',
  'preview.noInlinePreview': 'Bu dosya türü için önizleme yok.',
  'preview.tooLarge': 'Önizleme için çok büyük ({size}).',
  'preview.loadError': 'Önizleme yüklenemedi: {error}',
  'lightbox.close': 'Büyütülmüş görünümü kapat',
  'lightbox.loadError': 'Bu görsel yüklenemedi: {error}',

  'turbo.balanceUnavailable': 'Bakiye kullanılamıyor',
  'turbo.loadingBalance': 'Bakiye yükleniyor…',
  'turbo.enableUploads': 'Yüklemeleri etkinleştir',
  'turbo.wrongKeyFile':
    'Bu anahtar dosyası farklı bir adrese ait — burada yüklemeleri etkinleştirmek için özgün dosyayı seçin.',

  'error.watchOnlySession':
    'Bu salt izleme oturumudur — değişiklik yapmak için imzalayabilen bir cüzdan bağlayın.',
  'error.signingUnavailable':
    'Bu oturumda imzalama kullanılamıyor. Devam etmek için cüzdanınızı yeniden bağlayın.',
  'error.extensionGone':
    'Cüzdan eklentisi artık kullanılamıyor. Devam etmek için yeniden bağlanın.',
  'error.keyFileNotLoaded':
    'Anahtar dosyanız bu oturumda yüklü değil — devam etmek için yeniden seçin.',
  'error.cannotSign': 'Bu oturum imzalayamıyor — imzalayabilen bir cüzdan bağlayın.',
  'error.insufficientCredits':
    'Bu yükleme için yeterli Turbo krediniz yok. Bakiyenizi yükleyip yeniden deneyin.',
  'error.signingRejected': 'İmzalama cüzdanınızda reddedildi.',
  'error.noExtension':
    'Arweave cüzdan eklentisi bulunamadı. Bağlanmak için Wander yükleyin.',
  'error.badAddress':
    'Bu bir Arweave adresine benzemiyor (43 karakter, A–Z a–z 0–9 _ -).',
  'error.notKeyFile': 'Bu bir Arweave anahtar dosyası değil: “n” modülü eksik.',
  'error.connectToUnlock':
    'Özel bir sürücünün kilidini açmak için imzalayabilen bir cüzdan bağlayın.',
  'error.decryptionFailed': 'Şifre çözme başarısız — sürücü parolasını denetleyin.',
  'error.sessionCannotSign': 'Bu oturum imzalayamıyor — imzalayabilen bir cüzdan bağlayın.',
  'error.extensionUnavailable': 'Cüzdan eklentisi kullanılamıyor.',
  'error.keyFileNotInSession': 'Anahtar dosyası bu oturumda yüklü değil.',
  'error.bridgeUnavailable':
    'Bu sürücünün imza verileri ağdan alınamadı. Bu, yanlış parola değil, bir ağ geçidi/ağ sorunudur — lütfen birazdan yeniden deneyin.',
  'error.estimateFailed': 'Yükleme maliyeti hesaplanamadı.',
  'error.readKeyFile': 'Anahtar dosyası okunamadı: {message}',
  'error.walletCantSign':
    'Cüzdanınız bu isteği imzalayamadı ({message}). Cüzdanınız eski imzalama desteğini kaldırdıysa bunun için bir SDK güncellemesi gerekir — yeniden denemek çözmez.',
};

/**
 * Turkish nouns stay singular after a numeral ("5 dosya", never "5 dosyalar"), so both CLDR
 * categories carry the same, singular form — the count itself does the pluralizing.
 */
export const trPlurals: PluralMessages = {
  items: { one: '{count} öge', other: '{count} öge' },
  matches: { one: '{count} eşleşme', other: '{count} eşleşme' },
  revisions: { one: '{count} sürüm', other: '{count} sürüm' },
  orphaned: { one: '{count} sahipsiz', other: '{count} sahipsiz' },
  confirmUpload: {
    one: 'Onayla ve {count} dosya yükle',
    other: 'Onayla ve {count} dosya yükle',
  },
  confirmDownload: {
    one: '{count} öge indir',
    other: '{count} öge indir',
  },
};
