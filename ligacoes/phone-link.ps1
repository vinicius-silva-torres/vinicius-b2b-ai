param(
    [Parameter(Mandatory = $true)][ValidateSet('open', 'prepare', 'dial', 'observe', 'inspect')][string]$Action,
    [ValidatePattern('^\+55[0-9]{10,11}$')][string]$Number
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms

$ui = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$control = [System.Windows.Automation.ControlType]
$invoke = [System.Windows.Automation.InvokePattern]::Pattern
$selection = [System.Windows.Automation.SelectionItemPattern]::Pattern
$value = [System.Windows.Automation.ValuePattern]::Pattern
$trueCondition = [System.Windows.Automation.Condition]::TrueCondition

function Write-Result($item) {
    $item | ConvertTo-Json -Compress -Depth 4
}

function Open-PhoneLink {
    Start-Process 'explorer.exe' -ArgumentList 'ms-phone:'
}

function Get-Windows {
    $appIds = @(Get-Process -Name PhoneExperienceHost, YourPhone -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Id)
    foreach ($window in $ui::RootElement.FindAll($scope::Children, $trueCondition)) {
        try {
            $current = $window.Current
            if ($appIds -contains $current.ProcessId -or
                $current.Name -match '^(Phone Link|Vincular ao Celular|V.lo com o Celular|V.nculo ao Telem.vel|Your Phone|Seu Telefone)$') {
                $window
            }
        } catch [System.Windows.Automation.ElementNotAvailableException] {}
    }
}

function Get-Controls($windows) {
    foreach ($window in $windows) {
        foreach ($element in $window.FindAll($scope::Descendants, $trueCondition)) {
            try {
                $current = $element.Current
                if (!$current.IsOffscreen) {
                    [pscustomobject]@{
                        Element = $element; Name = $current.Name; Id = $current.AutomationId
                        Type = $current.ControlType; Enabled = $current.IsEnabled
                    }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] {}
        }
    }
}

function Find-One($items, [string]$idPattern, [string]$namePattern) {
    $matchingIds = @($items | Where-Object { $_.Id -match $idPattern })
    if ($matchingIds.Count -eq 1) { return $matchingIds[0] }
    $matchingNames = @($items | Where-Object { $_.Name -match $namePattern })
    if ($matchingNames.Count -eq 1) { return $matchingNames[0] }
}

function Activate-Control($item) {
    foreach ($patternId in @($invoke, $selection)) {
        $pattern = $null
        if ($item.Element.TryGetCurrentPattern($patternId, [ref]$pattern)) {
            if ($patternId -eq $invoke) { $pattern.Invoke() } else { $pattern.Select() }
            return $true
        }
    }
    return $false
}

function Find-NumberField($items) {
    $fields = @($items | Where-Object { $_.Enabled -and $_.Type -in @($control::Edit, $control::ComboBox) })
    $ids = '^(PhoneNumberTextBox|DialerTextBox|DialPadTextBox|CallSearchBox|CallsSearchBox|SearchContactsTextBox)$'
    $names = '^(Search your contacts|Search contacts|Phone number|Enter a name or number|Enter phone number|Pesquisar seus contatos|Pesquisar contatos|Buscar contatos|Buscar seus contatos|N.mero (de telefone|do telefone)|Insira um nome ou n.mero|Digite um nome ou n.mero)$'
    Find-One $fields $ids $names
}

function Get-PhoneValue($item) {
    if (!$item) { return }
    $pattern = $null
    if ($item.Element.TryGetCurrentPattern($value, [ref]$pattern)) { return $pattern }
}

function Is-ExpectedNumber([string]$candidate) {
    if (!$Number) { return $false }
    $digits = $candidate -replace '\D', ''
    $target = $Number -replace '\D', ''
    return $digits -eq $target -or $digits -eq $target.Substring(2)
}

function Find-DialControl($items) {
    $buttons = @($items | Where-Object { $_.Type -eq $control::Button })
    $ids = '^(DialButton|CallButton|ButtonCall|PlaceCallButton|MakeCallButton|StartCallButton|DialPadCallButton)$'
    $names = '^(Dial|Call|Make a call|Place call|Start call|Ligar|Discar|Iniciar chamada|Fazer chamada|Fazer uma chamada|Efetuar chamada|Marcar)$'
    Find-One $buttons $ids $names
}

function Get-DialedNumber($items) {
    $display = $items | Where-Object Id -eq 'AccumulatorTextBlock' | Select-Object -First 1
    if ($display -and $display.Name) { return $display.Name }
    $pattern = Get-PhoneValue (Find-NumberField $items)
    if ($pattern) { return $pattern.Current.Value }
    return ''
}

function Click-KeypadControl($item) {
    if (!$item.Enabled -or $item.Id -notmatch '^Button(?:[0-9]|Backspace)$') { return $false }
    $point = New-Object System.Windows.Point
    if (!$item.Element.TryGetClickablePoint([ref]$point)) { return $false }
    $hit = $ui::FromPoint($point)
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $target = $item.Element.GetRuntimeId() -join ','
    for ($i = 0; $i -lt 8 -and $hit; $i++) {
        if (($hit.GetRuntimeId() -join ',') -eq $target) { break }
        $hit = $walker.GetParent($hit)
    }
    if (!$hit -or ($hit.GetRuntimeId() -join ',') -ne $target) { return $false }
    if (!('VwsKeypadMouse' -as [type])) {
        Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class VwsKeypadMouse {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint x, uint y, uint data, System.UIntPtr extra);
    public static void Click(int x, int y) {
        Point previous;
        if (!GetCursorPos(out previous) || !SetCursorPos(x, y)) return;
        mouse_event(2, 0, 0, 0, System.UIntPtr.Zero);
        mouse_event(4, 0, 0, 0, System.UIntPtr.Zero);
        SetCursorPos(previous.X, previous.Y);
    }
}
'@
    }
    [VwsKeypadMouse]::Click([int]$point.X, [int]$point.Y)
    return $true
}

function Get-KeypadDigits($items) {
    $display = $items | Where-Object Id -eq 'AccumulatorTextBlock' | Select-Object -First 1
    return [string]($display.Name -replace '\D', '')
}

function Press-Keypad($item, [string]$expected) {
    if (!$item) { throw 'Um controle do teclado do Phone Link ficou indisponível.' }
    Activate-Control $item | Out-Null
    Start-Sleep -Milliseconds 110
    $items = @(Get-Controls @(Get-Windows))
    if ((Get-KeypadDigits $items) -eq $expected) { return $items }
    if (!(Click-KeypadControl $item)) {
        throw 'Deixe o teclado do Phone Link visível para preencher o número.'
    }
    Start-Sleep -Milliseconds 180
    $items = @(Get-Controls @(Get-Windows))
    if ((Get-KeypadDigits $items) -ne $expected) {
        throw 'O teclado do Phone Link não confirmou o número. Confira o discador manualmente.'
    }
    return $items
}

function Enter-KeypadNumber($items) {
    $digits = Get-KeypadDigits $items
    if ($digits.Length -gt 24) { throw 'Limpe o teclado do Phone Link antes de preparar outro número.' }
    while ($digits.Length) {
        $backspace = $items | Where-Object Id -eq 'ButtonBackspace' | Select-Object -First 1
        $digits = $digits.Substring(0, $digits.Length - 1)
        $items = @(Press-Keypad $backspace $digits)
    }
    # Dial the Brazilian national number through the paired SIM.
    foreach ($digit in $Number.Substring(3).ToCharArray()) {
        $key = $items | Where-Object { $_.Id -eq ('Button' + $digit) -and $_.Type -eq $control::Button -and $_.Enabled } | Select-Object -First 1
        $digits += $digit
        $items = @(Press-Keypad $key $digits)
    }
}

function Get-CallState($items) {
    $hangup = @($items | Where-Object {
        $_.Type -eq $control::Button -and $_.Enabled -and
        ($_.Id -match '^(EndCallButton|HangUpButton|DisconnectCallButton)$' -or
         $_.Name -match '^(End call|Hang ?up|Disconnect call|Desligar|Encerrar chamada|Terminar chamada)$')
    })
    $incoming = @($items | Where-Object {
        $_.Name -match '^(Incoming call|Chamada recebida|Chamada de entrada|Chamada a chegar)$'
    })
    if ($hangup.Count -gt 0 -and !$incoming.Count) {
        $outgoing = @($items | Where-Object {
            $_.Name -match '^(Calling|Dialing|Outgoing call|Ligando|Discando|Chamando|Chamada de sa.da)[.\u2026 ]*$'
        })
        return @{ state = 'call'; matchesNumber = [bool](@($items | Where-Object {
            $_.Type -eq $control::Text -and $_.Name -match '^[+0-9 ().-]+$' -and
            (Is-ExpectedNumber $_.Name)
        }).Count); outgoing = [bool]$outgoing.Count }
    }
    if ($incoming.Count) { return @{ state = 'unknown' } }
    $disconnected = @($items | Where-Object {
        $_.Name -match '^(Disconnected|Not connected|Desconectado|Desligado|N.o conectado)$'
    })
    if ($disconnected.Count) { return @{ state = 'disconnected' } }
    $dial = Find-DialControl $items
    if ($dial -and ((Find-NumberField $items) -or ($items.Id -contains 'Keypad'))) {
        return @{ state = 'idle' }
    }
    return @{ state = 'unknown' }
}

try {
    if ($Action -eq 'open') {
        Open-PhoneLink
        Write-Result @{ ok = $true }
        return
    }
    $windows = @(Get-Windows)
    if (!$windows.Count -and $Action -eq 'prepare') {
        Open-PhoneLink
        for ($i = 0; $i -lt 12 -and !$windows.Count; $i++) {
            Start-Sleep -Milliseconds 400
            $windows = @(Get-Windows)
        }
    }
    $items = @(Get-Controls $windows)
    $state = Get-CallState $items
    if ($Action -eq 'observe') { Write-Result $state; return }
    if ($Action -eq 'inspect') {
        $knownNames = '^(Phone Link|Calls|Chamadas|Search your contacts|Pesquisar seus contatos|Dial|Call|Ligar|End call|Hang up|Desligar|Encerrar chamada|Connected|Conectado|Disconnected|Desconectado)$'
        $controls = @($items | Where-Object {
            $_.Type -in @($control::Button, $control::Edit, $control::TabItem) -and
            ($_.Name -match $knownNames -or $_.Id -match 'call|dial|search')
        } | Select-Object -First 50 | ForEach-Object {
            @{ name = $(if ($_.Name -match $knownNames) { $_.Name } else { '' })
               id = ($_.Id -replace '\d{4,}', '[id]'); type = $_.Type.ProgrammaticName; enabled = $_.Enabled }
        })
        Write-Result @{ state = $state.state; controls = $controls }
        return
    }
    if (!$windows.Count) { throw 'Abra o Phone Link com o celular conectado e tente novamente.' }
    if ($state.state -in @('call', 'disconnected')) { throw 'O Phone Link está em chamada ou desconectado.' }
    if ($Action -eq 'prepare' -and !(Find-NumberField $items) -and !($items.Id -contains 'Keypad')) {
        $tabs = @($items | Where-Object {
            $_.Type -in @($control::TabItem, $control::Button, $control::ListItem) -and $_.Enabled
        })
        $tab = Find-One $tabs '^(CallingNodeAutomationId|CallsNavButton|CallsTab|CallsNavigationItem)$' '^(Calls|Chamadas|Liga..es)$'
        if ($tab -and (Activate-Control $tab)) {
            for ($i = 0; $i -lt 8 -and !(Find-NumberField $items); $i++) {
                Start-Sleep -Milliseconds 250
                $items = @(Get-Controls @(Get-Windows))
            }
        }
    }
    if ($Action -eq 'prepare') {
        if ($items.Id -contains 'Keypad' -and $items.Id -contains 'Button0') {
            Enter-KeypadNumber $items
        } else {
            $phoneField = Find-NumberField $items
            $phoneValue = Get-PhoneValue $phoneField
            if (!$phoneValue) { throw 'Não consegui ler o discador. Use Copiar telefone e cole em Calls.' }
            try {
                if (!$phoneValue.Current.IsReadOnly) { $phoneValue.SetValue($Number) }
            } catch [System.InvalidOperationException] {}
            if (!(Is-ExpectedNumber $phoneValue.Current.Value)) {
                $phoneField.Element.SetFocus()
                $focused = $ui::FocusedElement
                if (!$focused -or ($focused.GetRuntimeId() -join ',') -ne ($phoneField.Element.GetRuntimeId() -join ',')) {
                    throw 'O campo do Phone Link não recebeu foco para preencher o telefone.'
                }
                [System.Windows.Forms.SendKeys]::SendWait('^a{+}' + $Number.Substring(1))
            }
        }
        $ready = $false
        for ($i = 0; $i -lt 5 -and !$ready; $i++) {
            $items = @(Get-Controls @(Get-Windows))
            $dial = Find-DialControl $items
            $ready = (Is-ExpectedNumber (Get-DialedNumber $items)) -and $dial -and $dial.Enabled
            if ($ready) { break }
            Start-Sleep -Milliseconds 200
        }
        if (!$ready) {
            throw 'O Phone Link não confirmou o número e o botão de chamada. Confira o discador manualmente.'
        }
        Write-Result @{ ok = $true }
        return
    }
    if (!(Is-ExpectedNumber (Get-DialedNumber $items))) {
        throw 'O número no Phone Link mudou. Prepare o número novamente antes de ligar.'
    }
    $dial = Find-DialControl $items
    if (!$dial -or !$dial.Enabled -or !(Activate-Control $dial)) {
        throw 'Botão de discagem indisponível. Confira o telefone e clique em Ligar no Phone Link.'
    }
    Write-Result @{ ok = $true }
} catch {
    Write-Result @{ ok = $false; error = $_.Exception.Message }
}
