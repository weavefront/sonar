import type { Messages, PluralMessages } from '../types';

export const ru: Messages = {
  'common.cancel': 'Отмена',
  'common.continue': 'Продолжить',
  'common.close': 'Закрыть',
  'common.copied': 'Скопировано',
  'common.or': 'или',
  'common.creating': 'Создание…',
  'common.confirmCreate': 'Подтвердить и создать',
  'common.decrypting': 'Расшифровка…',
  'common.stillConfirming':
    'Загружено — ещё подтверждается в Arweave. Это может занять несколько минут.',

  'app.notFound': 'Страница не найдена.',
  'app.tagline': 'Быстрый файловый браузер для Arweave',
  'shell.watching': 'наблюдение',
  'shell.exit': 'Выйти',
  'theme.switchToLight': 'Переключить на светлую тему',
  'theme.switchToDark': 'Переключить на тёмную тему',
  'language.label': 'Язык',

  'modal.estimatingCost': 'Расчёт стоимости…',
  'modal.cost': 'Стоимость: {amount}',

  'connect.newToArweave': 'Впервые в Arweave?',
  'connect.newToArweaveBody':
    'Получите кошелёк за один шаг — без регистрации и электронной почты. Вы получите фразу восстановления и файл ключа; сохраните любой из них, и вы уже пользователь Sonar.',
  'connect.createWallet': 'Создать новый кошелёк',
  'connect.alreadyHaveWallet': 'Уже есть кошелёк?',
  'connect.alreadyHaveWalletBody':
    'Ваши файлы из ArDrive появятся здесь — Sonar читает те же данные ArFS.',
  'connect.connecting': 'Подключение…',
  'connect.connectExtension': 'Подключить расширение кошелька',
  'connect.connectWander': 'Подключить Wander',
  'connect.noExtension': 'Расширение не обнаружено. {link} или воспользуйтесь вариантами ниже.',
  'connect.installWander': 'Установите Wander',
  'connect.useKeyFile': 'Использовать файл ключа',
  'connect.keyFileNote':
    'Только чтение: адрес вычисляется в вашем браузере, а ключ сразу же удаляется.',
  'connect.viewAnyAddress': 'Или посмотрите любой адрес',
  'connect.addressPlaceholder': 'Адрес Arweave из 43 символов',
  'connect.view': 'Открыть',
  'connect.privateDrivesNote':
    'Приватные диски тоже работают — введите пароль диска, чтобы просматривать его и записывать в него в течение этого сеанса. Ничего никогда не сохраняется.',

  'driveList.title': 'Ваши диски',
  'driveList.searching': 'поиск…',
  'driveList.newDrive': 'Новый диск',
  'driveList.refresh': 'Обновить',
  'driveList.loading': 'Загрузка дисков',
  'driveList.empty': 'Диски не найдены',
  'driveList.emptyBody':
    'У этого адреса пока нет дисков ArFS, либо они ещё не проиндексированы.',
  'driveList.createdWithVersion': 'Создан {date} · ArFS {version}',
  'driveList.privateDrives': 'Приватные диски',
  'driveList.unlockedCreated': 'Разблокирован в этом сеансе · создан {date}',
  'driveList.encryptedCreated': 'Зашифрован · создан {date}',
  'driveList.open': 'Открыть',
  'driveList.unlock': 'Разблокировать',
  'driveList.needsSigning': 'Требуется подпись',
  'driveList.privateHintCanSign':
    'Введите пароль диска, чтобы расшифровать его и просматривать в течение этого сеанса — ничего не сохраняется.',
  'driveList.privateHintWatchOnly':
    'Подключите кошелёк, способный подписывать (не только для наблюдения), чтобы разблокировать приватный диск.',

  'driveBrowser.privateCantShare': 'Этот диск приватный, им нельзя поделиться.',
  'driveBrowser.notPartOfShare': 'Эта папка не входит в эту ссылку общего доступа.',
  'driveBrowser.goToParent': 'Перейти в родительскую папку',
  'driveBrowser.sharedFolder': 'Общая папка',
  'driveBrowser.drive': 'Диск',
  'driveBrowser.folder': 'Папка',
  'driveBrowser.shareFolder': 'Поделиться этой папкой',
  'driveBrowser.resync': 'Пересинхронизировать диск',
  'driveBrowser.resyncTitle': 'Пересинхронизировать из сети',
  'driveBrowser.search': 'Поиск по этому диску',
  'driveBrowser.sortBy': 'Сортировать по',
  'driveBrowser.sortName': 'Имя',
  'driveBrowser.sortSize': 'Размер',
  'driveBrowser.sortModified': 'Изменён',
  'driveBrowser.sortAscending': 'Сортировать по возрастанию',
  'driveBrowser.sortDescending': 'Сортировать по убыванию',
  'driveBrowser.readOnlyBanner': 'Общая папка · только чтение',
  'driveBrowser.noMatches': 'Ничего не найдено по запросу «{query}».',
  'driveBrowser.emptyFolder': 'Эта папка пуста.',
  'driveBrowser.loadingDrive': 'Загрузка этого диска…',
  'driveBrowser.breadcrumb': 'Навигационная цепочка',
  'driveBrowser.listView': 'Списком',
  'driveBrowser.iconView': 'Значками',
  'driveBrowser.denseView': 'Компактно',
  'driveBrowser.layout': 'Вид',
  'driveBrowser.tilesSmall': 'Мелкие плитки',
  'driveBrowser.tilesMedium': 'Средние плитки',
  'driveBrowser.tilesLarge': 'Крупные плитки',
  'driveBrowser.tileSize': 'Размер плиток',
  'driveBrowser.checkingUpdates': 'проверка обновлений',
  'driveBrowser.syncing': 'синхронизация {resolved}/{found}',
  'driveBrowser.syncFailed': 'сбой синхронизации — показаны данные из кэша',
  'driveBrowser.orphanedTitle': 'Объекты, для которых не найдена родительская папка',
  'driveBrowser.showHidden': 'Показать скрытые',
  'driveBrowser.hideHidden': 'Скрыть скрытые',
  'driveBrowser.unresolvedMeta': 'Метаданные недоступны со шлюза',
  'driveBrowser.encrypted': 'зашифровано',
  'driveBrowser.folderWithDate': 'Папка · {date}',
  'driveBrowser.processingTitle':
    'Загружено, но ещё не подтверждено в Arweave — это может занять несколько минут.',
  'driveBrowser.processing': 'Обработка',
  'driveBrowser.details': 'Подробности',

  'details.forFile': 'Подробности о {name}',
  'details.close': 'Закрыть подробности',
  'details.viewExpanded': 'Открыть во весь экран',
  'details.preparingDownload': 'Подготовка загрузки…',
  'details.download': 'Скачать',
  'details.copyLink': 'Скопировать ссылку',
  'details.copyValue': 'Копировать {label}',
  'details.downloadError': 'Не удалось скачать этот файл: {error}',
  'details.size': 'Размер',
  'details.type': 'Тип',
  'details.modified': 'Изменён',
  'details.uploaded': 'Загружен',
  'details.path': 'Путь',
  'details.fileId': 'ID файла',
  'details.dataTx': 'TX данных',
  'details.metadataTx': 'TX метаданных',
  'details.block': 'Блок',
  'details.arfs': 'ArFS',
  'details.pinnedFrom': 'Закреплено из',
  'details.versionHistory': 'История версий',
  'details.current': 'текущая',
  'details.encryptedTag': '(зашифровано)',

  'rowMenu.moreActions': 'Другие действия',
  'rowMenu.rename': 'Переименовать',
  'rowMenu.move': 'Переместить',
  'rowMenu.hide': 'Скрыть',
  'rowMenu.unhide': 'Показать',

  'hide.hideFileTitle': 'Скрыть файл',
  'hide.hideFolderTitle': 'Скрыть папку',
  'hide.unhideFileTitle': 'Показать файл',
  'hide.unhideFolderTitle': 'Показать папку',
  'hide.willHide':
    '«{name}» будет скрыт при обычном просмотре (останется виден при включённом «Показать скрытые» и всегда доступен для чтения напрямую из транзакции).',
  'hide.willUnhide': '«{name}» снова появится при обычном просмотре.',
  'hide.saving': 'Сохранение…',
  'hide.confirmHide': 'Подтвердить и скрыть',
  'hide.confirmUnhide': 'Подтвердить и показать',

  'createDrive.title': 'Новый диск',
  'createDrive.name': 'Название диска',
  'createDrive.namePlaceholder': 'Мой диск',
  'createDrive.makePrivate': 'Сделать этот диск приватным',
  'createDrive.password': 'Пароль',
  'createDrive.confirmPassword': 'Подтвердите пароль',
  'createDrive.passwordMismatch': 'Пароли не совпадают.',
  'createDrive.noRecovery':
    'Восстановление пароля невозможно. Если вы потеряете этот пароль, содержимое диска будет утрачено навсегда — никто, включая нас, не сможет его вернуть.',

  'createFolder.title': 'Новая папка',
  'createFolder.name': 'Название папки',
  'createFolder.namePlaceholder': 'Новая папка',

  'createWallet.title': 'Создать новый кошелёк',
  'createWallet.generating': 'Создание вашего кошелька…',
  'createWallet.generatingNote':
    'Это может занять до двух минут — ваш браузер генерирует настоящий ключевой материал, совместимый с Arweave. Пожалуйста, не закрывайте эту вкладку.',
  'createWallet.error': 'Не удалось создать кошелёк: {error}',
  'createWallet.phraseLabel': 'Ваша фраза восстановления из 12 слов',
  'createWallet.copyPhrase': 'Скопировать фразу',
  'createWallet.downloadKeyfile': 'Скачать файл ключа',
  'createWallet.warning':
    'Это единственная копия. Если вы её потеряете, этот кошелёк и всё его содержимое будут утрачены навсегда — никто, включая нас, не сможет их вернуть. Sonar никогда её не хранит.',
  'createWallet.confirmSaved': 'Я сохранил фразу восстановления или файл ключа',
  'createWallet.continuing': 'Продолжение…',
  'createWallet.continueToApp': 'Перейти в Sonar',

  'rename.fileTitle': 'Переименовать файл',
  'rename.folderTitle': 'Переименовать папку',
  'rename.renaming': 'Переименование…',
  'rename.confirm': 'Подтвердить и переименовать',
  'move.title': 'Переместить {name}',
  'move.destination': 'Папка назначения',
  'move.moving': 'Перемещение…',
  'move.confirm': 'Подтвердить и переместить',

  'password.title': 'Разблокировать приватный диск',
  'password.prompt': 'Введите пароль для {name}.',
  'password.placeholder': 'Пароль диска',
  'password.wrong': 'Этот пароль не подходит к этому диску.',
  'password.technicalDetails': 'Технические подробности',
  'password.unlocking': 'Разблокировка…',
  'password.unlock': 'Разблокировать',

  'share.title': 'Поделиться «{name}»',
  'share.whatToInclude': 'Что включить',
  'share.thisFolderAndSubfolders': 'Эту папку и её подпапки',
  'share.justThisFolder': 'Только эту папку',
  'share.link': 'Ссылка',
  'share.copy': 'Копировать',
  'share.noteWithSubfolders':
    'Любой, у кого есть эта ссылка, может просматривать и скачивать эту папку и всё её содержимое — без учётной записи и кошелька. Эти данные и так публичны в Arweave; ссылка просто ведёт прямо к ним.',
  'share.noteFolderOnly':
    'Любой, у кого есть эта ссылка, может просматривать и скачивать файлы, лежащие непосредственно в этой папке — без учётной записи и кошелька. Эти данные и так публичны в Arweave; ссылка просто ведёт прямо к ним.',
  'shareRoute.invalid': 'Эта ссылка общего доступа недействительна.',

  'upload.dropToUpload': 'Отпустите, чтобы загрузить',
  'upload.uploadFiles': 'Загрузить файлы',
  'upload.uploadFolder': 'Загрузить папку',
  'upload.newFolder': 'Новая папка',
  'upload.panelTitle': 'Загрузки',
  'upload.clearFinished': 'Очистить завершённые',
  'upload.estimating': 'Расчёт…',
  'upload.uploading': 'Загрузка…',
  'upload.done': 'Готово',
  'upload.remove': 'Убрать {name}',
  'upload.total': 'Итого: {amount}',

  'download.selectAll': 'Выбрать все',
  'download.selectItem': 'Выбрать {name}',
  'download.downloadAll': 'Скачать всё',
  'download.waitForLoad': 'Станет доступно, когда папка загрузится',
  'download.panelTitle': 'Скачивания',
  'download.collecting': 'Подготовка…',
  'download.fetchingProgress': 'Скачивание {completed} из {total} файлов…',
  'download.saving': 'Сохранение…',
  'download.done': 'Готово',
  'download.partialFailure': 'Скачано {succeeded} из {total} файлов — остальные не удалось скачать.',

  'preview.locked': 'Этот диск заблокирован в текущем сеансе.',
  'preview.noDataTx':
    'Нет транзакции с данными — метаданные этого файла не ссылаются на содержимое.',
  'preview.decryptError': 'Не удалось расшифровать этот файл: {error}',
  'preview.noInlinePreview': 'Для этого типа файлов предпросмотр недоступен.',
  'preview.tooLarge': 'Слишком большой для предпросмотра ({size}).',
  'preview.loadError': 'Не удалось загрузить предпросмотр: {error}',
  'lightbox.close': 'Закрыть полноэкранный просмотр',
  'lightbox.loadError': 'Не удалось загрузить это изображение: {error}',

  'turbo.balanceUnavailable': 'Баланс недоступен',
  'turbo.loadingBalance': 'Загрузка баланса…',
  'turbo.enableUploads': 'Включить загрузки',
  'turbo.wrongKeyFile':
    'Этот файл ключа принадлежит другому адресу — выберите исходный, чтобы включить здесь загрузки.',

  'error.watchOnlySession':
    'Это сеанс только для наблюдения — подключите кошелёк, способный подписывать, чтобы вносить изменения.',
  'error.signingUnavailable':
    'Подпись недоступна в этом сеансе. Переподключите кошелёк, чтобы продолжить.',
  'error.extensionGone':
    'Расширение кошелька больше недоступно. Переподключитесь, чтобы продолжить.',
  'error.keyFileNotLoaded':
    'Ваш файл ключа не загружен в этом сеансе — выберите его снова, чтобы продолжить.',
  'error.cannotSign': 'Этот сеанс не может подписывать — подключите кошелёк, который может.',
  'error.insufficientCredits':
    'Недостаточно кредитов Turbo для этой загрузки. Пополните баланс и попробуйте снова.',
  'error.signingRejected': 'Подпись была отклонена в вашем кошельке.',
  'error.noExtension':
    'Расширение кошелька Arweave не найдено. Установите Wander для подключения.',
  'error.badAddress':
    'Это не похоже на адрес Arweave (43 символа, A–Z a–z 0–9 _ -).',
  'error.notKeyFile': 'Это не файл ключа Arweave: отсутствует модуль «n».',
  'error.connectToUnlock':
    'Подключите кошелёк, способный подписывать, чтобы разблокировать приватный диск.',
  'error.decryptionFailed': 'Не удалось расшифровать — проверьте пароль диска.',
  'error.sessionCannotSign':
    'Этот сеанс не может подписывать — подключите кошелёк, который может.',
  'error.extensionUnavailable': 'Расширение кошелька недоступно.',
  'error.keyFileNotInSession': 'Файл ключа не загружен в этом сеансе.',
  'error.bridgeUnavailable':
    'Не удалось получить из сети данные подписи этого диска. Это проблема шлюза или сети, а не неверный пароль — попробуйте ещё раз через мгновение.',
  'error.estimateFailed': 'Не удалось рассчитать стоимость загрузки.',
  'error.readKeyFile': 'Не удалось прочитать файл ключа: {message}',
  'error.walletCantSign':
    'Ваш кошелёк не смог подписать этот запрос ({message}). Если в кошельке убрана поддержка устаревшей подписи, потребуется обновление SDK — повторные попытки не помогут.',
};

/**
 * Russian is the reason `PluralForms` exists: it genuinely needs four categories, and
 * `Intl.PluralRules` picks between them from CLDR data — 1 файл, 2 файла, 5 файлов, 21 файл.
 */
export const ruPlurals: PluralMessages = {
  items: {
    one: '{count} элемент',
    few: '{count} элемента',
    many: '{count} элементов',
    other: '{count} элемента',
  },
  matches: {
    one: '{count} совпадение',
    few: '{count} совпадения',
    many: '{count} совпадений',
    other: '{count} совпадения',
  },
  revisions: {
    one: '{count} версия',
    few: '{count} версии',
    many: '{count} версий',
    other: '{count} версии',
  },
  orphaned: {
    one: '{count} потерянный',
    few: '{count} потерянных',
    many: '{count} потерянных',
    other: '{count} потерянных',
  },
  confirmUpload: {
    one: 'Подтвердить и загрузить {count} файл',
    few: 'Подтвердить и загрузить {count} файла',
    many: 'Подтвердить и загрузить {count} файлов',
    other: 'Подтвердить и загрузить {count} файла',
  },
  confirmDownload: {
    one: 'Скачать {count} элемент',
    few: 'Скачать {count} элемента',
    many: 'Скачать {count} элементов',
    other: 'Скачать {count} элемента',
  },
};
